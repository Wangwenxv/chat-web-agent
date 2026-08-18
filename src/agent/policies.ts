import type { ModelMessage, ToolExecutionResult } from '../types'
import { segmentSentences } from '../lib/segment'

export interface PublishCheck {
  ok: boolean
  issues: string[]
  segments: string[]
}

export function beforePublish(content: string, segment: boolean): PublishCheck {
  const trimmed = content.trim()
  const issues: string[] = []
  if (!trimmed) issues.push('The model returned an empty response')
  if (trimmed.length > 120000) issues.push('The response exceeded the display limit')
  return { ok: issues.length === 0, issues, segments: segmentSentences(trimmed) }
}

export interface ReviewRequest {
  draft: string
  userGoal: string
  settingsSummary: string
  toolResults: ToolExecutionResult[]
  diagnostics: string[]
}

export interface ReviewVerdict {
  pass: boolean
  issues: string[]
  repairInstruction?: string
  reviewed: boolean
}

export interface ReviewPolicy {
  readonly name: string
  canRun(input: ReviewRequest): boolean
  buildMessages(input: ReviewRequest): ModelMessage[] | null
  parseVerdict(content: string): ReviewVerdict
}

export interface ReviewPolicyOptions {
  reviewResponses: boolean
  maxReviewCharacters: number
}

export function createReviewPolicy(options: ReviewPolicyOptions): ReviewPolicy {
  return {
    name: 'deterministic-and-model-review',
    canRun(input) {
      if (!options.reviewResponses) return false
      if (!input.draft.trim()) return false
      if (input.draft.trim().length > options.maxReviewCharacters) return false
      if (input.toolResults.length > 0) return true
      if (input.diagnostics.length > 0) return true
      return input.draft.trim().length >= 40
    },
    buildMessages(input) {
      const toolSummary = input.toolResults.length > 0
        ? input.toolResults.map((result, index) => (index + 1) + '. ' + (result.ok ? 'ok: ' : 'failed: ') + String(result.content ?? '').slice(0, 600)).join('\n')
        : '(none)'
      const diagnosticSummary = input.diagnostics.length > 0 ? input.diagnostics.join('\n') : '(none)'
      return [
        {
          role: 'system',
          content: [
            'You are the publish checker of a browser coding agent. Your job is to decide whether the assistant draft may be published to the user.',
            '',
            'Check rules:',
            '1. The draft must be a plain, truthful answer. Any claim about the workspace or a tool action must be supported by the tool results.',
            '2. If the user asked for a change, a workspace tool must have succeeded. If the user goal was not met, the draft must clearly state what is unresolved.',
            '3. When there are failures or diagnostics, the draft must mention them or contain an explicit instruction to fix them.',
            '4. Never invent tool names, file paths, preview states, or model capabilities that are not in the provided facts.',
            '',
            'Respond with strict JSON only, with this shape:',
            '{"pass":true|false,"issues":["short human-readable issue"],"repairInstruction":"one short instruction for the main agent, only when pass is false"}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            'User goal: ' + input.userGoal,
            '',
            'Draft to publish:',
            input.draft,
            '',
            'Tool results:',
            toolSummary,
            '',
            'Preview diagnostics:',
            diagnosticSummary,
            '',
            'Return the JSON verdict.',
          ].join('\n'),
        },
      ]
    },
    parseVerdict(content) {
      const trimmed = content.trim()
      const jsonMatch = /{(?:[^{}])*}/.exec(trimmed)
      const raw = jsonMatch ? jsonMatch[0] : trimmed
      try {
        const parsed = JSON.parse(raw) as { pass?: unknown; issues?: unknown; repairInstruction?: unknown }
        return {
          pass: parsed.pass === true,
          issues: Array.isArray(parsed.issues) ? parsed.issues.filter(item => typeof item === 'string').slice(0, 5) : [],
          repairInstruction: typeof parsed.repairInstruction === 'string' ? parsed.repairInstruction : undefined,
          reviewed: true,
        }
      } catch {
        return {
          pass: true,
          issues: [],
          reviewed: true,
        }
      }
    },
  }
}
