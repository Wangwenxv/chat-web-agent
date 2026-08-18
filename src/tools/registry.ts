import type {
  AgentSettings,
  SearchResultItem,
  ToolExecutionResult,
  ToolCallRequest,
} from '../types'
import { buildLineDiff } from '../lib/diff'
import { BrowserRepository } from '../workspace/repository'

export interface ToolContext {
  repository: BrowserRepository
  workspaceId: string
  settings: AgentSettings
  signal?: AbortSignal
}

export interface ModelToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const stringProperty = (description: string) => ({ type: 'string', description })

export const toolDefinitions: ModelToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'workspace_list',
      description: 'List files in the browser virtual workspace. This is the only workspace you can access.',
      parameters: {
        type: 'object',
        properties: { prefix: stringProperty('Optional relative path prefix') },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_read',
      description: 'Read text from a file in the browser virtual workspace.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: stringProperty('Relative workspace path, for example index.html'),
          startLine: { type: 'integer', minimum: 1, description: 'Optional 1-based start line' },
          endLine: { type: 'integer', minimum: 1, description: 'Optional inclusive end line' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_write',
      description: 'Create or replace a web workspace file. Use this for HTML, CSS, JavaScript, JSON, SVG, or text assets. Never write Python, shell, PowerShell, executables, or server scripts.',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: stringProperty('Relative workspace path'),
          content: stringProperty('Complete text file content'),
          expectedRevision: { type: 'integer', minimum: 1, description: 'Optional revision read previously' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_edit',
      description: 'Apply one exact text replacement to a file after reading it. The revision must match the current file revision.',
      parameters: {
        type: 'object',
        required: ['path', 'oldText', 'newText', 'expectedRevision'],
        properties: {
          path: stringProperty('Relative workspace path'),
          oldText: stringProperty('Exact existing text to replace once'),
          newText: stringProperty('Replacement text'),
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_grep',
      description: 'Search text inside the browser virtual workspace. This does not search the user computer.',
      parameters: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: stringProperty('Plain text or JavaScript regular expression'),
          path: stringProperty('Optional path prefix or exact file path'),
          caseSensitive: { type: 'boolean', description: 'Default false' },
          useRegex: { type: 'boolean', description: 'Default false; use plain text search unless needed' },
          maxResults: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 50' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_diff',
      description: 'Show line changes between the current file and a saved revision.',
      parameters: {
        type: 'object',
        required: ['path', 'revision'],
        properties: {
          path: stringProperty('Relative workspace path'),
          revision: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search public web information using the configured browser-side provider. Search results may fail because of provider CORS.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: { query: stringProperty('Search query') },
        additionalProperties: false,
      },
    },
  },
]

export async function executeTool(call: ToolCallRequest, context: ToolContext): Promise<ToolExecutionResult> {
  let args: Record<string, unknown>
  try {
    const parsed = JSON.parse(call.function.arguments || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('arguments must be an object')
    args = parsed as Record<string, unknown>
  } catch (error) {
    return failure(`Invalid arguments for ${call.function.name}: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    switch (call.function.name) {
      case 'workspace_list': return await workspaceList(args, context)
      case 'workspace_read': return await workspaceRead(args, context)
      case 'workspace_write': return await workspaceWrite(args, context)
      case 'workspace_edit': return await workspaceEdit(args, context)
      case 'workspace_grep': return await workspaceGrep(args, context)
      case 'workspace_diff': return await workspaceDiff(args, context)
      case 'web_search': return await webSearch(args, context)
      default: return failure(`Unknown tool: ${call.function.name}`)
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

async function workspaceList(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
  const prefix = typeof args.prefix === 'string' ? args.prefix.replaceAll('\\', '/').replace(/^\/+/, '') : ''
  const files = (await context.repository.listFiles(context.workspaceId))
    .filter(file => !prefix || file.path.startsWith(prefix))
    .map(file => ({ path: file.path, language: file.language, bytes: file.content.length, revision: file.revision, previewable: file.previewable }))
  return success(JSON.stringify({ files, count: files.length }, null, 2), files)
}

async function workspaceRead(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
  const path = requiredString(args.path, 'path')
  const file = await context.repository.getFile(context.workspaceId, path)
  if (!file) return failure(`File not found: ${path}`)
  const lines = file.content.split('\n')
  const start = Math.max(1, numberArg(args.startLine, 1))
  const end = Math.min(lines.length, numberArg(args.endLine, lines.length))
  const body = lines.slice(start - 1, end).map((line, index) => `${String(start + index).padStart(4, ' ')} | ${line}`).join('\n')
  return success(JSON.stringify({ path: file.path, revision: file.revision, startLine: start, endLine: end, content: body }, null, 2), { path: file.path, revision: file.revision })
}

async function workspaceWrite(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
  const path = requiredString(args.path, 'path')
  const content = requiredString(args.content, 'content')
  const expectedRevision = args.expectedRevision === undefined ? undefined : numberArg(args.expectedRevision, 0)
  const file = await context.repository.writeFile(context.workspaceId, path, content, expectedRevision)
  return success(JSON.stringify({ path: file.path, revision: file.revision, bytes: content.length, preview: file.previewable ? 'rebuild scheduled' : 'stored as text; no browser preview adapter' }, null, 2), { path: file.path, revision: file.revision }, file.path)
}

async function workspaceEdit(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
  const file = await context.repository.editFile(
    context.workspaceId,
    requiredString(args.path, 'path'),
    requiredString(args.oldText, 'oldText'),
    requiredString(args.newText, 'newText'),
    numberArg(args.expectedRevision, 0),
  )
  return success(JSON.stringify({ path: file.path, revision: file.revision, preview: file.previewable ? 'rebuild scheduled' : 'stored as text' }, null, 2), { path: file.path, revision: file.revision }, file.path)
}

async function workspaceGrep(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
  const pattern = requiredString(args.pattern, 'pattern')
  const useRegex = args.useRegex === true
  const caseSensitive = args.caseSensitive === true
  const maxResults = Math.min(100, Math.max(1, numberArg(args.maxResults, 50)))
  let matcher: RegExp
  try {
    matcher = new RegExp(useRegex ? pattern : escapeRegExp(pattern), caseSensitive ? 'g' : 'gi')
  } catch (error) {
    return failure(`Invalid search pattern: ${error instanceof Error ? error.message : String(error)}`)
  }
  const pathFilter = typeof args.path === 'string' ? args.path.replaceAll('\\', '/') : ''
  const matches: Array<{ path: string; line: number; text: string }> = []
  for (const file of await context.repository.listFiles(context.workspaceId)) {
    if (pathFilter && !file.path.startsWith(pathFilter)) continue
    const lines = file.content.split('\n')
    lines.forEach((text, index) => {
      matcher.lastIndex = 0
      if (matcher.test(text) && matches.length < maxResults) matches.push({ path: file.path, line: index + 1, text: text.trim().slice(0, 400) })
    })
    if (matches.length >= maxResults) break
  }
  return success(JSON.stringify({ pattern, matches, truncated: matches.length >= maxResults }, null, 2), matches)
}

async function workspaceDiff(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
  const path = requiredString(args.path, 'path')
  const revision = numberArg(args.revision, 0)
  const current = await context.repository.getFile(context.workspaceId, path)
  const revisions = await context.repository.listRevisions(context.workspaceId, path)
  const saved = revisions.find(item => item.revision === revision)
  if (!current || !saved) return failure(`Revision ${revision} was not found for ${path}`)
  const diff = buildLineDiff(saved.content, current.content)
  return success(JSON.stringify({ path, fromRevision: revision, toRevision: current.revision, diff }, null, 2), diff)
}

async function webSearch(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
  const query = requiredString(args.query, 'query')
  if (context.settings.searchProvider === 'disabled') return failure('Web search is disabled in Settings. Enable a browser-side provider first.')
  if (context.settings.demoMode) {
    const results: SearchResultItem[] = [{ title: 'Demo search result', url: 'https://example.com/', snippet: `Demo mode received the query: ${query}`, source: 'demo' }]
    return success(JSON.stringify({ query, results, source: 'demo' }, null, 2), results)
  }
  if (context.settings.searchProvider === 'duckduckgo') {
    const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, { signal: context.signal })
    if (!response.ok) return failure(`Search provider returned HTTP ${response.status}`)
    const data = await response.json() as { AbstractText?: string; AbstractURL?: string; Heading?: string; RelatedTopics?: unknown[] }
    const results: SearchResultItem[] = []
    if (data.AbstractText && data.AbstractURL) results.push({ title: data.Heading || query, url: data.AbstractURL, snippet: data.AbstractText, source: 'DuckDuckGo' })
    collectDuckResults(data.RelatedTopics, results)
    return success(JSON.stringify({ query, results: results.slice(0, 10), source: 'DuckDuckGo' }, null, 2), results.slice(0, 10))
  }
  const endpoint = context.settings.searchEndpoint.trim()
  if (!endpoint) return failure('Custom search endpoint is empty')
  const headers = parseHeaders(context.settings.searchHeaders)
  const response = await fetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`, { headers, signal: context.signal })
  if (!response.ok) return failure(`Custom search provider returned HTTP ${response.status}`)
  const data = await response.json() as { results?: SearchResultItem[] }
  const results = Array.isArray(data.results) ? data.results.slice(0, 10) : []
  return success(JSON.stringify({ query, results, source: 'custom' }, null, 2), results)
}

function collectDuckResults(items: unknown[] | undefined, output: SearchResultItem[]): void {
  if (!items) return
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const value = item as { FirstURL?: string; Text?: string; Topics?: unknown[] }
    if (value.FirstURL && value.Text) output.push({ title: value.Text.split(' - ')[0] ?? value.Text, url: value.FirstURL, snippet: value.Text, source: 'DuckDuckGo' })
    collectDuckResults(value.Topics, output)
    if (output.length >= 10) return
  }
}

function parseHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {}
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Search headers must be a JSON object')
  return Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item === 'string'))
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string`)
  return value
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function success(content: string, data?: unknown, changedPath?: string): ToolExecutionResult {
  return { ok: true, content: cap(content), data, changedPath }
}

function failure(error: string): ToolExecutionResult {
  return { ok: false, error, content: JSON.stringify({ ok: false, error }) }
}

function cap(value: string): string {
  return value.length > 65536 ? `${value.slice(0, 65536)}\n...[result truncated]` : value
}

