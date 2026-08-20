import { segmentSentences } from '../lib/segment'

export interface PublishCheck {
  ok: boolean
  issues: string[]
  segments: string[]
}

export function beforePublish(content: string): PublishCheck {
  const trimmed = content.trim()
  const issues: string[] = []
  if (!trimmed) issues.push('The model returned an empty response')
  if (trimmed.length > 120000) issues.push('The response exceeded the display limit')
  return { ok: issues.length === 0, issues, segments: segmentSentences(trimmed) }
}
