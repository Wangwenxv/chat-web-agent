export type FileKind =
  | 'html'
  | 'css'
  | 'javascript'
  | 'json'
  | 'svg'
  | 'typescript'
  | 'markdown'
  | 'text'

export interface WorkspaceFile {
  path: string
  content: string
  language: string
  kind: FileKind
  previewable: boolean
  revision: number
  updatedAt: number
}

export interface WorkspaceRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  entryPath: string
}

export interface SessionRecord {
  id: string
  workspaceId: string
  title: string
  createdAt: number
  updatedAt: number
  modelId: string
  archivedAt?: number
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessageRecord {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  createdAt: number
  name?: string
  toolCallId?: string
  toolCalls?: ToolCallRequest[]
  status?: 'streaming' | 'final' | 'error'
}

export interface AgentEventRecord {
  id: string
  sessionId: string
  type:
    | 'user_message'
    | 'assistant_delta'
    | 'assistant_message'
    | 'tool_call'
    | 'tool_result'
    | 'workspace_mutation'
    | 'preview_diagnostic'
    | 'turn_end'
    | 'error'
  createdAt: number
  payload: unknown
}

export interface AgentSettings {
  apiBaseUrl: string
  apiKey: string
  model: string
  customHeaders: string
  maxSteps: number
  maxToolCalls: number
}

export interface PreviewPermissions {
  allowSameOrigin: boolean
  allowPopups: boolean
  allowDownloads: boolean
  allowForms: boolean
  allowModals: boolean
  allowFullscreen: boolean
  allowClipboard: boolean
  allowMicrophone: boolean
  allowCamera: boolean
  allowNetwork: boolean
  allowExternalScripts: boolean
  allowExternalImages: boolean
  allowExternalFonts: boolean
  allowEval: boolean
}

export const DEFAULT_PREVIEW_PERMISSIONS: PreviewPermissions = {
  allowSameOrigin: true,
  allowPopups: true,
  allowDownloads: true,
  allowForms: true,
  allowModals: true,
  allowFullscreen: true,
  allowClipboard: true,
  allowMicrophone: true,
  allowCamera: true,
  allowNetwork: true,
  allowExternalScripts: true,
  allowExternalImages: true,
  allowExternalFonts: true,
  allowEval: true,
}

export interface SearchResultItem {
  title: string
  url: string
  snippet: string
  source?: string
}

export interface PreviewDiagnostic {
  level: 'info' | 'warn' | 'error'
  message: string
  detail?: string
}

export interface PreviewArtifact {
  srcdoc: string
  diagnostics: PreviewDiagnostic[]
  entryPath?: string
}

export interface ToolCallRequest {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolExecutionResult {
  ok: boolean
  content: string
  data?: unknown
  changedPath?: string
  error?: string
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCallRequest[]
}

export type ModelChunk =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; call: ToolCallRequest }
  | { kind: 'done'; finishReason?: string; usage?: ModelResponse['usage'] }
  | { kind: 'error'; message: string }

export interface ModelResponse {
  id?: string
  content: string
  toolCalls: ToolCallRequest[]
  finishReason?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  model?: string
}
