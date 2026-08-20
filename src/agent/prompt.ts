import type {
  ChatAttachment,
  ModelContentPart,
  ModelMessage,
  ToolCallRequest,
  WorkspaceFile,
  WorkspaceRecord,
} from '../types'

export function buildSystemPrompt(
  workspace: WorkspaceRecord,
  files: WorkspaceFile[],
  supportsMultimodal: boolean,
): string {
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
  const instructions = files
    .filter((file) => isInstructionFile(file.path))
    .sort(
      (a, b) => instructionDepth(a.path) - instructionDepth(b.path) || a.path.localeCompare(b.path),
    )
  const instructionText = instructions.length === 0 ? '(none)' : renderInstructions(instructions)
  const visionCapability = supportsMultimodal
    ? 'The model configured for this session supports vision: the user may attach images (screenshots, mockups, or design references). Treat them as first-class input, read their visible content carefully, and reference what you see when answering or making changes.'
    : 'The model configured for this session does NOT support vision: the user may still attach images, but you cannot analyze their content. Never pretend to see an image. Ask the user to describe it in text or to place it in the workspace so you can inspect it.'
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
    'web_search queries public repositories and developer communities (GitHub, Stack Overflow, Hacker News, npm) in parallel and needs no API key. Use it when the user asks for current information, technical facts, or anything outside the virtual workspace. Present the found URLs and sources clearly.',
    '',
    'Current virtual workspace snapshot:',
    fileSummary,
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
