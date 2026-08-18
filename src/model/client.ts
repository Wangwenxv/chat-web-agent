import type { AgentSettings, ModelMessage, ModelResponse, ToolCallRequest } from '../types'
import type { ModelToolDefinition } from '../tools/registry'

export async function requestModel(
  settings: AgentSettings,
  messages: ModelMessage[],
  tools: ModelToolDefinition[],
  signal?: AbortSignal,
): Promise<ModelResponse> {
  if (settings.demoMode) return demoResponse(messages)
  const baseUrl = settings.apiBaseUrl.trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('Model API base URL is empty')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey.trim()) headers.Authorization = 'Bearer ' + settings.apiKey.trim()
  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: settings.model, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
    signal,
  })
  const raw = await response.text()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Model API returned non-JSON HTTP ' + response.status)
  }
  if (!response.ok) throw new Error(readApiError(data, response.status))
  const choice = (data as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown[] }; finish_reason?: string }> }).choices?.[0]
  if (!choice?.message) throw new Error('Model API response did not contain a message')
  const message = choice.message
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.flatMap(parseToolCall) : []
  return {
    id: (data as { id?: string }).id,
    content: typeof message.content === 'string' ? message.content : '',
    toolCalls,
    finishReason: choice.finish_reason,
    usage: (data as { usage?: ModelResponse['usage'] }).usage,
  }
}

function parseToolCall(value: unknown): ToolCallRequest[] {
  if (!value || typeof value !== 'object') return []
  const item = value as { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } }
  if (typeof item.id !== 'string' || item.type !== 'function' || !item.function || typeof item.function.name !== 'string') return []
  return [{
    id: item.id,
    type: 'function',
    function: { name: item.function.name, arguments: typeof item.function.arguments === 'string' ? item.function.arguments : '{}' },
  }]
}

function readApiError(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const error = (data as { error?: { message?: unknown } }).error
    if (error && typeof error.message === 'string') return 'Model API HTTP ' + status + ': ' + error.message
  }
  return 'Model API HTTP ' + status
}

function demoResponse(messages: ModelMessage[]): ModelResponse {
  const latestUser = [...messages].reverse().find(message => message.role === 'user')?.content?.toLowerCase() ?? ''
  const hasWrite = messages.some(message => message.role === 'tool' && message.name === 'workspace_write')
  const hasSearch = messages.some(message => message.role === 'tool' && message.name === 'web_search')
  if (!hasWrite && /(写|改|做|创建|页面|网站|按钮|landing|html|css|界面|样式)/i.test(latestUser)) {
    const accent = latestUser.includes('绿') ? '#c4f36a' : '#9ab8ff'
    const html = [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent made page</title><link rel="stylesheet" href="styles.css"></head>',
      '<body><main class="scene"><p class="tag">LOCAL / LIVE</p><h1>把想法，<em>放进浏览器。</em></h1><p>这是 Agent 写入虚拟工作台的第一版。右侧预览与文件树都来自浏览器本地状态。</p><button id="action">点一下试试</button><span id="feedback"></span></main><script src="main.js"></script></body></html>',
    ].join('\n')
    const css = [
      ':root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#f4f7ff;background:#101522}',
      '*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(135deg,#101522,#1d2c4c)}',
      '.scene{max-width:680px;min-height:100vh;margin:auto;padding:16vh 8vw;display:grid;align-content:center;gap:20px}',
      '.tag{margin:0;color:' + accent + ';font-size:12px;font-weight:800;letter-spacing:.18em}',
      '.scene h1{margin:0;font-size:clamp(46px,8vw,92px);line-height:.94;letter-spacing:-.05em}.scene em{display:block;color:' + accent + ';font-style:normal}',
      '.scene p:not(.tag){max-width:520px;margin:0;color:#b8c4d9;font-size:18px;line-height:1.6}.scene button{width:max-content;border:0;border-radius:10px;padding:13px 18px;background:' + accent + ';color:#101522;font:inherit;font-weight:800;cursor:pointer}.scene button:hover{filter:brightness(1.12)}#feedback{color:#dce7ff;font-size:14px}',
    ].join('')
    const js = "document.querySelector('#action')?.addEventListener('click',()=>{document.querySelector('#feedback').textContent='  Preview is running in a sandbox.'})"
    return {
      content: '我先把一个可交互的页面落到浏览器工作台里，然后让预览区立即重建。',
      toolCalls: [
        { id: 'demo-write-' + Date.now(), type: 'function', function: { name: 'workspace_write', arguments: JSON.stringify({ path: 'index.html', content: html, expectedRevision: 1 }) } },
        { id: 'demo-write-css-' + Date.now(), type: 'function', function: { name: 'workspace_write', arguments: JSON.stringify({ path: 'styles.css', content: css, expectedRevision: 1 }) } },
        { id: 'demo-write-js-' + Date.now(), type: 'function', function: { name: 'workspace_write', arguments: JSON.stringify({ path: 'main.js', content: js, expectedRevision: 1 }) } },
      ],
    }
  }
  if (!hasSearch && /(搜索|查一下|查找|天气|新闻|资料|search|weather|news)/i.test(latestUser)) {
    return {
      content: '我先查一下公开信息，再把结果整理给你。',
      toolCalls: [{ id: 'demo-search-' + Date.now(), type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: latestUser }) } }],
    }
  }
  return {
    content: '已收到。当前运行在浏览器工作台中，文件、会话和工具事件都保存在本机 IndexedDB。' + (latestUser ? '你刚才说的是“' + latestUser.slice(0, 80) + '”。' : ''),
    toolCalls: [],
  }
}

