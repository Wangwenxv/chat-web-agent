import type { AgentSettings } from '../types'
import { requestModel } from '../model/client'

export const TURN_TITLE_MIN_CHARS = 6
export const TURN_TITLE_MAX_CHARS = 12
const TURN_TITLE_TIMEOUT_MS = 15_000

/**
 * Generate a short title for the first user question.
 * Runs a separate model call that never blocks the agent turn and never
 * throws: failures simply yield no title.
 */
export async function summarizeUserQuestion(settings: AgentSettings, text: string): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TURN_TITLE_TIMEOUT_MS)
  try {
    const response = await requestModel({
      settings,
      messages: [
        { role: 'system', content: TURN_TITLE_SYSTEM_PROMPT },
        { role: 'user', content: '用户提问：\n' + text },
      ],
      tools: [],
    })
    return normalizeTurnTitle(response.content)
  } catch {
    return undefined
  } finally {
    window.clearTimeout(timer)
  }
}

const TURN_TITLE_SYSTEM_PROMPT = [
  '为用户的提问生成一个简洁的中文标题。',
  '只输出标题本身，一行，不要引号、前缀、解释或任何标点装饰。',
  `标题必须为 ${TURN_TITLE_MIN_CHARS}-${TURN_TITLE_MAX_CHARS} 个汉字，概括提问意图。`,
].join('\n')

/** Keep the first non-empty line and enforce the character range. */
function normalizeTurnTitle(raw: string): string | undefined {
  const line = raw
    .split('\n')
    .map(item => item.trim())
    .find(item => item.length > 0)
  if (line === undefined) return undefined
  const cleaned = line.replace(/^["'「『【(（\s]+|["'」』】)）\s]+$/g, '').trim()
  if (cleaned.length < TURN_TITLE_MIN_CHARS) return undefined
  return cleaned.slice(0, TURN_TITLE_MAX_CHARS)
}
