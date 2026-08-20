import type {
  AgentEventRecord,
  AgentSettings,
  ChatAttachment,
  ChatMessageRecord,
  ToolCallRequest,
} from '../types'
import { beforePublish } from './policies'
import { buildSystemPrompt, deriveModelMessages } from './prompt'
import { requestModel } from '../model/client'
import { executeTool, toolDefinitions } from '../tools/registry'
import { buildPreview } from '../preview/build'
import { summarizeUserQuestion } from './title'
import { BrowserRepository } from '../workspace/repository'

export interface RunTurnOptions {
  repository: BrowserRepository
  workspaceId: string
  sessionId: string
  settings: AgentSettings
  text: string
  attachments?: ChatAttachment[]
  signal?: AbortSignal
  onEvent?: (event: AgentEventRecord) => void | Promise<void>
  onDelta?: (delta: string) => void
}

export interface RunTurnResult {
  assistantMessage?: ChatMessageRecord
  toolCalls: number
  steps: number
}

function id(prefix: string): string {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(16).slice(2)
}

export async function runUserTurn(options: RunTurnOptions): Promise<RunTurnResult> {
  const { repository, workspaceId, sessionId, settings, signal, onEvent, onDelta } = options
  let steps = 0
  let toolCallCount = 0
  const pendingDiagnostics: string[] = []
  const emit = async (type: AgentEventRecord['type'], payload: unknown): Promise<void> => {
    const event: AgentEventRecord = {
      id: id('event'),
      sessionId,
      type,
      createdAt: Date.now(),
      payload,
    }
    await repository.appendEvent(event)
    await onEvent?.(event)
  }
  const userMessage: ChatMessageRecord = {
    id: id('message'),
    sessionId,
    role: 'user',
    content: options.text.trim(),
    ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    createdAt: Date.now(),
    status: 'final',
  }
  await repository.appendMessage(userMessage)
  await emit('user_message', { messageId: userMessage.id, content: userMessage.content })
  if (!userMessage.content && !userMessage.attachments?.length)
    throw new Error('Message cannot be empty')

  // First turn only: derive the short title with a separate model call before
  // the agent starts working, so the session title updates immediately.
  const isFirstTurn = (await repository.listMessages(sessionId)).length === 1
  if (isFirstTurn && userMessage.content) {
    const turnTitle = await summarizeUserQuestion(settings, userMessage.content)
    if (turnTitle !== undefined) {
      await repository.renameSession(sessionId, turnTitle)
      await emit('turn_title', { messageId: userMessage.id, turnTitle })
    }
  }

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Turn cancelled', 'AbortError')
      steps += 1
      const workspace = await repository.getWorkspace(workspaceId)
      if (!workspace) throw new Error('Workspace no longer exists')
      const files = await repository.listFiles(workspaceId)
      const history = await repository.listMessages(sessionId)
      const modelMessages = deriveModelMessages([
        { role: 'system', content: buildSystemPrompt(workspace, files) },
        ...history.map((message) => ({
          role: message.role,
          content: message.content,
          name: message.name,
          toolCallId: message.toolCallId,
          toolCalls: message.toolCalls,
          attachments: message.attachments,
        })),
      ])
      const response = await requestModel({
        settings,
        messages: modelMessages,
        tools: toolDefinitions,
        signal,
        onDelta,
      })
      if (response.toolCalls.length > 0) {
        const toolAssistant: ChatMessageRecord = {
          id: id('message'),
          sessionId,
          role: 'assistant',
          content: response.content,
          createdAt: Date.now(),
          toolCalls: response.toolCalls,
          status: 'final',
        }
        await repository.appendMessage(toolAssistant)
        for (const call of response.toolCalls) {
          toolCallCount += 1
          await emit('tool_call', { call, step: steps })
          const result = await executeTool(call, { repository, workspaceId, settings, signal })
          const toolMessage: ChatMessageRecord = {
            id: id('message'),
            sessionId,
            role: 'tool',
            name: call.function.name,
            toolCallId: call.id,
            content: result.content,
            createdAt: Date.now(),
            status: result.ok ? 'final' : 'error',
          }
          await repository.appendMessage(toolMessage)
          await emit('tool_result', { callId: call.id, name: call.function.name, result })
          if (result.changedPath) {
            await emit('workspace_mutation', { path: result.changedPath, tool: call.function.name })
            const nextFiles = await repository.listFiles(workspaceId)
            const artifact = buildPreview(nextFiles)
            for (const diagnostic of artifact.diagnostics) {
              const text = diagnostic.level + ': ' + diagnostic.message
              if (pendingDiagnostics.includes(text)) continue
              pendingDiagnostics.push(text)
              await emit('preview_diagnostic', {
                path: result.changedPath,
                level: diagnostic.level,
                message: diagnostic.message,
                detail: diagnostic.detail,
              })
            }
          }
        }
        continue
      }

      const check = beforePublish(response.content)
      if (!check.ok) throw new Error(check.issues.join('; '))
      const assistantMessage: ChatMessageRecord = {
        id: id('message'),
        sessionId,
        role: 'assistant',
        content: response.content.trim(),
        createdAt: Date.now(),
        status: 'final',
      }
      await repository.appendMessage(assistantMessage)
      await emit('assistant_message', {
        messageId: assistantMessage.id,
        content: assistantMessage.content,
        segments: check.segments,
      })
      await emit('turn_end', {
        steps,
        toolCalls: toolCallCount,
        segmented: true,
        segments: check.segments,
      })
      return { assistantMessage, toolCalls: toolCallCount, steps }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await emit('error', { message, steps, toolCalls: toolCallCount })
    throw error
  }
}

export function getToolCallSummary(call: ToolCallRequest): string {
  try {
    const args = JSON.parse(call.function.arguments) as Record<string, unknown>
    const path =
      typeof args.path === 'string' ? args.path : typeof args.query === 'string' ? args.query : ''
    return path ? call.function.name + ' · ' + path : call.function.name
  } catch {
    return call.function.name
  }
}
