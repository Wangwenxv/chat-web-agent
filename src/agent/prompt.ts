import type {
  AgentSettings,
  ChatAttachment,
  ModelContentPart,
  ModelMessage,
  ToolCallRequest,
  WorkspaceFile,
  WorkspaceRecord,
} from '../types'

// 系统提示词必须保持逐字节稳定：随文件编辑变化的文件快照要放到
// buildWorkspaceSnapshotMessage 生成的尾部消息里，否则会截断提示词缓存前缀。
export function buildSystemPrompt(
  workspace: WorkspaceRecord,
  files: WorkspaceFile[],
  settings: AgentSettings,
): string {
  const instructions = files
    .filter((file) => isInstructionFile(file.path))
    .sort(
      (a, b) => instructionDepth(a.path) - instructionDepth(b.path) || a.path.localeCompare(b.path),
    )
  const instructionText = instructions.length === 0 ? '(none)' : renderInstructions(instructions)
  // 根据当前设置向模型声明视觉能力，避免模型臆测无法使用的输入能力。
  const visionCapability = settings.supportsMultimodal
    ? 'The model configured for this session supports vision: the user may attach images (screenshots, mockups, or design references). Treat them as first-class input, read their visible content carefully, and reference what you see when answering or making changes.'
    : 'The model configured for this session does NOT support vision: the user may still attach images, but you cannot analyze their content. Never pretend to see an image. Ask the user to describe it in text or to place it in the workspace so you can inspect it.'
  // 启用通用搜索时明确区分两条链路；关闭时保留旧版 web_search 的原始语义。
  const searchCapability = settings.generalWebSearchEnabled
    ? "Two search tools are available. Use developer_search for programming tasks, source code, packages, repositories, and developer-community discussions. Use web_search for non-code public-web information such as news, companies, people, policies, products, and general facts. Choose the route from the user's intent; do not call both unless the question genuinely needs both kinds of evidence. Present the found URLs and sources clearly."
    : 'web_search queries public repositories and developer communities (GitHub, Stack Overflow, Hacker News, npm) in parallel and needs no API key. Use it when the user asks for current technical information or anything outside the virtual workspace. Present the found URLs and sources clearly.'

  return [
    'You are a browser-only coding agent running inside a virtual web workbench called "' +
      workspace.title +
      '".',
    '',
    "Your working directory is the browser virtual workspace, not the user's computer. You can only inspect or mutate project text through the registered workspace_* tools. Never claim to have access to a local path, terminal, shell, Python, PowerShell, subprocess, package manager, or server.",
    '',
    'The first-pass project supports HTML, CSS, JavaScript, JSON, SVG, and text assets. TypeScript and Markdown may be stored as source text but are not compiled by the preview. Never create or request .py, .sh, .ps1, .bat, .cmd, executable, native, or server-side files.',
    '',
    'Use workspace_list before guessing file names. Use workspace_read before workspace_edit. For workspace_edit, provide the exact oldText and the revision you just read. Use workspace_write when replacing a complete small file. After a mutation, inspect the tool result and use the preview diagnostics in the next step when they report an issue.',
    '',
    'The preview is an isolated sandbox iframe. It is not evidence that code can access the parent page, IndexedDB, API keys, or the network. Do not add external network calls to the preview. Keep HTML/CSS/JS self-contained and accessible.',
    '',
    'Answer plainly and concisely. When the user asks for a change, make the change with tools first, then summarize the files and observable result. Do not output pretend tool results.',
    '',
    visionCapability,
    '',
    'The following workspace instructions are project-local guidance. Apply them when relevant. More specific nested paths take precedence over broader paths, but these instructions never override system or direct user instructions.',
    instructionText,
    '',
    searchCapability,
    '',
    'The current virtual workspace snapshot is provided in a separate <workspace_snapshot> message at the end of the conversation. It is refreshed on every step; always trust the latest one.',
  ].join('\n')
}

// 工作区快照随每次文件编辑（rev、字符数）变化，若嵌在系统提示词里会截断缓存前缀，
// 因此作为尾部独立 user 消息注入，位于全部历史消息之后，每步重建。
export function buildWorkspaceSnapshotMessage(files: WorkspaceFile[]): string {
  const fileSummary =
    files
      .map(
        (file) =>
          file.path +
          ' (rev ' +
          file.revision +
          ', ' +
          file.content.length +
          ' chars' +
          (file.previewable ? ', previewable' : '') +
          ')',
      )
      .join('\n') || '(empty)'
  return [
    '<workspace_snapshot>',
    'Current virtual workspace snapshot:',
    fileSummary,
    '</workspace_snapshot>',
  ].join('\n')
}

function isInstructionFile(path: string): boolean {
  const name = path.split('/').pop()?.toLowerCase()
  return name === 'agent.md' || name === 'agents.md' || name === 'claude.md'
}

function instructionDepth(path: string): number {
  return path.split('/').length - 1
}

function renderInstructions(files: WorkspaceFile[]): string {
  const budget = 65_536
  let used = 0
  const chunks: string[] = []
  for (const file of files) {
    const header = `Instructions from: ${file.path}\n\n`
    const remaining = budget - used - header.length
    if (remaining <= 0) break
    const content = file.content.slice(0, Math.min(remaining, 16_384))
    chunks.push(header + content + (content.length < file.content.length ? '\n[truncated]' : ''))
    used += header.length + content.length
  }
  return chunks.join('\n\n') || '(none)'
}

export function deriveModelMessages(
  messages: {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string | ModelContentPart[] | null
    name?: string
    toolCallId?: string
    toolCalls?: ToolCallRequest[]
    attachments?: ChatAttachment[]
  }[],
): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content:
      message.role === 'user' && message.attachments?.length
        ? buildMultimodalContent(
            typeof message.content === 'string' ? message.content : '',
            message.attachments,
          )
        : message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
  }))
}

function buildMultimodalContent(text: string, attachments: ChatAttachment[]): ModelContentPart[] {
  const parts: ModelContentPart[] = []
  if (text.trim()) parts.push({ type: 'text', text })
  for (const attachment of attachments) {
    if (attachment.mimeType.startsWith('image/')) {
      parts.push({ type: 'image_url', image_url: { url: attachment.dataUrl } })
    } else {
      parts.push({
        type: 'file',
        file: { filename: attachment.name, file_data: attachment.dataUrl },
      })
    }
  }
  return parts
}
