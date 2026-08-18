import type { AgentEventRecord, AgentSettings, ChatMessageRecord, ToolCallRequest, ToolExecutionResult } from '../types'
import { beforePublish, createReviewPolicy, type ReviewRequest } from './policies'
import { buildSystemPrompt, deriveModelMessages } from './prompt'
import { requestModel } from '../model/client'
import { executeTool, toolDefinitions } from '../tools/registry'
import { buildPreview } from '../preview/build'
import { BrowserRepository } from '../workspace/repository'

export interface RunTurnOptions {
  repository: BrowserRepository
  workspaceId: string
  sessionId: string
  settings: AgentSettings
  text: string
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
  let repairRounds = 0
  const pendingToolResults: ToolExecutionResult[] = []
  const pendingDiagnostics: string[] = []
  const emit = async (type: AgentEventRecord['type'], payload: unknown): Promise<void> => {
    const event: AgentEventRecord = { id: id('event'), sessionId, type, createdAt: Date.now(), payload }
    await repository.appendEvent(event)
    await onEvent?.(event)
  }
  const userMessage: ChatMessageRecord = { id: id('message'), sessionId, role: 'user', content: options.text.trim(), createdAt: Date.now(), status: 'final' }
  await repository.appendMessage(userMessage)
  await emit('user_message', { messageId: userMessage.id, content: userMessage.content })
  if (!userMessage.content) throw new Error('Message cannot be empty')

  const loadDiagnostics = async (): Promise<string[]> => {
    const events = await repository.listEvents(sessionId)
    const diagnostics = events
      .filter(event => event.type === 'preview_diagnostic')
      .flatMap(event => {
        const payload = event.payload as { message?: unknown; level?: unknown } | undefined
        return typeof payload?.message === 'string' ? [String(payload.level ?? '') + ': ' + payload.message] : []
      })
    return [...new Set(diagnostics)].slice(-6)
  }

  const reviewInput = async (draft: string): Promise<ReviewRequest> => ({
    draft,
    userGoal: userMessage.content,
    settingsSummary: '',
    toolResults: pendingToolResults,
    diagnostics: pendingDiagnostics.length > 0 ? pendingDiagnostics : await loadDiagnostics(),
  })

  try {
    while (steps < settings.maxSteps) {
      if (signal?.aborted) throw new DOMException('Turn cancelled', 'AbortError')
      steps += 1
      const workspace = await repository.getWorkspace(workspaceId)
      if (!workspace) throw new Error('Workspace no longer exists')
      const files = await repository.listFiles(workspaceId)
      const history = await repository.listMessages(sessionId)
      const modelMessages = deriveModelMessages([
        { role: 'system', content: buildSystemPrompt(workspace, files, settings) },
        ...history.map(message => ({
          role: message.role,
          content: message.content,
          name: message.name,
          toolCallId: message.toolCallId,
          toolCalls: message.toolCalls,
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
        if (toolCallCount + response.toolCalls.length > settings.maxToolCalls) {
          throw new Error('Tool-call limit reached for this turn')
        }
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
          pendingToolResults.push(result)
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
              await emit('preview_diagnostic', { path: result.changedPath, level: diagnostic.level, message: diagnostic.message, detail: diagnostic.detail })
            }
          }
        }
        continue
      }

      const check = beforePublish(response.content, settings.segmentResponses)
      if (!check.ok) throw new Error(check.issues.join('; '))
      const assistantMessage: ChatMessageRecord = {
        id: id('message'),
        sessionId,
        role: 'assistant',
        content: response.content.trim(),
        createdAt: Date.now(),
        status: 'final',
      }
      const reviewPolicy = createReviewPolicy({ reviewResponses: settings.reviewResponses, maxReviewCharacters: 12000 })
      if (reviewPolicy.canRun(await reviewInput(assistantMessage.content))) {
        const input = await reviewInput(assistantMessage.content)
        const reviewMessages = reviewPolicy.buildMessages(input)
        const verdict = reviewMessages
          ? reviewPolicy.parseVerdict((await requestModel({ settings, messages: reviewMessages, tools: [], signal })).content)
          : { pass: true, issues: [], reviewed: false }
        await emit('review_result', {
          draft: assistantMessage.content,
          pass: verdict.pass,
          issues: verdict.issues,
          repairInstruction: verdict.repairInstruction,
          toolCallCount,
          steps,
          reviewed: verdict.reviewed,
        })
        if (!verdict.pass && verdict.repairInstruction) {
          repairRounds += 1
          if (repairRounds > settings.maxRepairRounds) {
            await repository.appendMessage(assistantMessage)
            await emit('assistant_message', { messageId: assistantMessage.id, content: assistantMessage.content, segments: check.segments })
            await emit('turn_end', { steps, toolCalls: toolCallCount, segmented: settings.segmentResponses, segments: check.segments, review: 'failed', issues: verdict.issues })
            return { assistantMessage, toolCalls: toolCallCount, steps }
          }
          const repairInstructionMessage: ChatMessageRecord = {
            id: id('message'),
            sessionId,
            role: 'user',
            content: 'The publish check rejected your last answer. Fix the issue and answer again.\n\nIssues:\n- ' + verdict.issues.join('\n- ') + '\n\nRepair instruction: ' + verdict.repairInstruction,
            createdAt: Date.now(),
            status: 'final',
          }
          await repository.appendMessage(repairInstructionMessage)
          continue
        }
      }
      await repository.appendMessage(assistantMessage)
      await emit('assistant_message', { messageId: assistantMessage.id, content: assistantMessage.content, segments: check.segments })
      await emit('turn_end', { steps, toolCalls: toolCallCount, segmented: settings.segmentResponses, segments: check.segments, repairRounds })
      return { assistantMessage, toolCalls: toolCallCount, steps }
    }
    throw new Error('Step limit reached for this turn')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await emit('error', { message, steps, toolCalls: toolCallCount, repairRounds })
    throw error
  }
}

export function getToolCallSummary(call: ToolCallRequest): string {
  try {
    const args = JSON.parse(call.function.arguments) as Record<string, unknown>
    const path = typeof args.path === 'string' ? args.path : typeof args.query === 'string' ? args.query : ''
    return path ? call.function.name + ' · ' + path : call.function.name
  } catch {
    return call.function.name
  }
}
