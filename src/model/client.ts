import type {
  AgentSettings,
  ConnectionTestResult,
  ModelMessage,
  ModelResponse,
  ModelUsage,
  ToolCallRequest,
  TurnUsage,
} from '../types'
import type { ModelToolDefinition } from '../tools/registry'
import { reasoningOptionsForModel } from '../lib/reasoning'

export interface RequestModelOptions {
  settings: AgentSettings
  messages: ModelMessage[]
  tools: ModelToolDefinition[]
  signal?: AbortSignal
  onDelta?: (text: string) => void
  // 需要打缓存断点的消息下标（Anthropic cache_control），仅在后端支持时生效。
  cacheBreakpoints?: number[]
}

export async function requestModel(options: RequestModelOptions): Promise<ModelResponse> {
  const { settings, messages, tools, signal, onDelta } = options
  const baseUrl = settings.apiBaseUrl.trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('Model API base URL is empty')
  if (!settings.model.trim()) throw new Error('Model name is empty')
  const headers = buildRequestHeaders(settings, { streaming: true })
  const useCacheControl = resolveCacheControl(settings)
  const body: Record<string, unknown> = {
    model: settings.model.trim(),
    messages: useCacheControl
      ? applyCacheBreakpoints(messages, options.cacheBreakpoints ?? [])
      : messages,
    tools: useCacheControl ? applyToolCacheControl(tools) : tools,
    tool_choice: 'auto',
    temperature: 0.2,
    stream: true,
    // 让 OpenAI 兼容链路在流式响应末尾回传 usage，否则看不到缓存命中统计。
    stream_options: { include_usage: true },
  }
  if (settings.reasoningEffort !== 'off') {
    const options = reasoningOptionsForModel(settings.reasoningOptions, settings.model)
    const effectiveKey = options
      ? (options.find((item) => item.key === settings.reasoningEffort)?.key ??
        options[0]?.key ??
        settings.reasoningEffort)
      : settings.reasoningEffort
    body.reasoning_effort = effectiveKey
  }
  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => '')
    let data: unknown = raw
    try {
      data = JSON.parse(raw)
    } catch {
      /* non-JSON error body */
    }
    throw new Error(readApiError(data, response.status))
  }
  return parseSseStream(response.body, signal, onDelta)
}

// 各家服务商的提示词缓存开启方式不同：DeepSeek/OpenAI 在服务端自动缓存，
// 只要请求前缀稳定即可；Anthropic（含透传 Claude 的中转）必须在消息体和
// 工具上显式打 cache_control 断点。auto 模式按模型名猜测，on 强制开启。
function resolveCacheControl(settings: AgentSettings): boolean {
  const mode = settings.promptCacheMode ?? 'auto'
  if (mode === 'off') return false
  if (mode === 'on') return true
  return /claude|anthropic/i.test(settings.model)
}

// 在指定消息上打 cache_control 断点：字符串内容需转为 content parts 形式。
// 断点之后的片段无法复用缓存，所以调用方应把断点打在稳定前缀的末端。
function applyCacheBreakpoints(messages: ModelMessage[], breakpoints: number[]): unknown[] {
  const marks = new Set(breakpoints)
  return messages.map((message, index) => {
    if (!marks.has(index) || message.content === null) return message
    if (typeof message.content === 'string') {
      return {
        ...message,
        content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }],
      }
    }
    if (message.content.length === 0) return message
    return {
      ...message,
      content: message.content.map((part, partIndex) =>
        partIndex === (message.content as unknown[]).length - 1
          ? { ...part, cache_control: { type: 'ephemeral' } }
          : part,
      ),
    }
  })
}

// Anthropic 的缓存前缀从 tools 开始，给最后一个工具打断点可缓存整个工具块。
function applyToolCacheControl(tools: ModelToolDefinition[]): unknown[] {
  if (tools.length === 0) return tools
  return tools.map((tool, index) =>
    index === tools.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool,
  )
}

// 归一化三家服务商的缓存命中字段：DeepSeek、OpenAI、Anthropic。
export function cachedTokensOf(usage: ModelUsage): number {
  return (
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    usage.cache_read_input_tokens ??
    0
  )
}

export function accumulateTurnUsage(target: TurnUsage, usage: ModelUsage): void {
  target.promptTokens += usage.prompt_tokens ?? 0
  target.completionTokens += usage.completion_tokens ?? 0
  target.cachedTokens += cachedTokensOf(usage)
}

const FORBIDDEN_HEADERS = new Set([
  'accept',
  'accept-charset',
  'accept-encoding',
  'accept-language',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
])

export function parseRequestHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {}
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Custom headers must be a JSON object')
  const output: Record<string, string> = {}
  for (const [name, item] of Object.entries(parsed)) {
    if (typeof item !== 'string' || item.length === 0) continue
    const lower = name.trim().toLowerCase()
    if (FORBIDDEN_HEADERS.has(lower)) continue
    if (lower.startsWith('proxy-') || lower.startsWith('sec-')) continue
    output[name.trim()] = item
  }
  return output
}

function buildRequestHeaders(
  settings: AgentSettings,
  options: { streaming: boolean },
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.streaming) headers.Accept = 'text/event-stream'
  if (settings.apiKey.trim()) headers.Authorization = 'Bearer ' + settings.apiKey.trim()
  Object.assign(headers, parseRequestHeaders(settings.customHeaders))
  return headers
}

export async function fetchModelList(
  settings: AgentSettings,
  signal?: AbortSignal,
): Promise<string[]> {
  const baseUrl = settings.apiBaseUrl.trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('Model API base URL is empty')
  const response = await fetch(baseUrl + '/models', {
    method: 'GET',
    headers: buildRequestHeaders(settings, { streaming: false }),
    signal,
  })
  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    throw new Error(
      readApiError(
        raw
          ? (() => {
              try {
                return JSON.parse(raw)
              } catch {
                return null
              }
            })()
          : null,
        response.status,
      ),
    )
  }
  const data = (await response.json()) as { data?: { id?: unknown }[] }
  if (!Array.isArray(data.data)) return []
  return data.data
    .map((item) => (typeof item.id === 'string' ? item.id : ''))
    .filter(Boolean)
    .sort()
}

async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  onDelta: ((text: string) => void) | undefined,
): Promise<ModelResponse> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let thinking = ''
  let finishReason: string | undefined
  let usage: ModelResponse['usage']
  let lastError: string | null = null
  const toolCalls = new Map<string, ToolCallRequest>()

  const parseLine = (line: string): void => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (data === '[DONE]') return
    let json: unknown
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    if (!json || typeof json !== 'object') return
    const chunk = json as {
      choices?: {
        delta?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown[] }
        finish_reason?: string
      }[]
      usage?: ModelResponse['usage']
      error?: unknown
    }
    if (chunk.error) {
      lastError = readApiError(chunk, 0)
      return
    }
    if (chunk.usage) usage = chunk.usage
    const choice = chunk.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta
    if (!delta) return
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content
      onDelta?.(delta.content)
    }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0)
      thinking += delta.reasoning_content
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) {
        mergeToolCallPart(toolCalls, part)
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (line.startsWith('data:')) parseLine(line)
    }
  }
  const rest = buffer.replace(/\r$/, '')
  if (rest.startsWith('data:')) parseLine(rest)

  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
  if (lastError !== null) throw new Error(lastError)
  return { content, toolCalls: [...toolCalls.values()], thinking, finishReason, usage }
}

function mergeToolCallPart(toolCalls: Map<string, ToolCallRequest>, part: unknown): void {
  if (!part || typeof part !== 'object') return
  const item = part as {
    id?: unknown
    index?: unknown
    type?: unknown
    function?: { name?: unknown; arguments?: unknown }
  }
  if (typeof item.index !== 'number' || !item.function) return
  const existing = toolCalls.get(String(item.index))
  if (!existing) {
    if (
      typeof item.id !== 'string' ||
      item.type !== 'function' ||
      typeof item.function.name !== 'string'
    )
      return
    toolCalls.set(String(item.index), {
      id: item.id,
      type: 'function',
      function: {
        name: item.function.name,
        arguments: typeof item.function.arguments === 'string' ? item.function.arguments : '',
      },
    })
    return
  }
  if (
    typeof item.function.name === 'string' &&
    typeof existing.function.name === 'string' &&
    item.function.name !== ''
  ) {
    existing.function.name = item.function.name
  }
  if (typeof item.function.arguments === 'string')
    existing.function.arguments += item.function.arguments
}

export async function testModelConnection(settings: AgentSettings): Promise<ConnectionTestResult> {
  const baseUrl = settings.apiBaseUrl.trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('Model API base URL is empty')
  if (!settings.model.trim()) throw new Error('Model name is empty')
  try {
    const response = await fetch(baseUrl + '/models', {
      method: 'GET',
      headers: buildRequestHeaders(settings, { streaming: false }),
    })
    if (response.ok) {
      const data = (await response.json().catch(() => null)) as {
        data?: { id?: string }[]
      } | null
      const found = data?.data?.some((item) => item.id === settings.model.trim())
      return {
        ok: true,
        message:
          '连接成功：' +
          settings.apiBaseUrl.trim() +
          (found ? '' : '。注意：服务器未列出 "' + settings.model.trim() + '"。'),
      }
    }
    const raw = await response.text().catch(() => '')
    return { ok: false, message: 'HTTP ' + response.status + (raw ? '：' + raw.slice(0, 240) : '') }
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    const hint =
      name === 'AbortError'
        ? '请求超时。'
        : '请求可能被 CORS 拦截，多数模型 API 不允许浏览器跨域直连。'
    return {
      ok: false,
      message:
        name === 'AbortError'
          ? hint
          : (error instanceof Error ? error.message : String(error)) + '。' + hint,
    }
  }
}

function readApiError(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const error = (data as { error?: { message?: unknown } }).error
    if (error && typeof error.message === 'string')
      return 'Model API' + (status ? ' HTTP ' + status : '') + ': ' + error.message
  }
  return 'Model API' + (status ? ' HTTP ' + status : '') + ' error'
}
