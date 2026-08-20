export interface ReasoningOption {
  key: string
  label: string
}

export interface ReasoningRule {
  match: string
  options: ReasoningOption[]
}

const DEFAULT_REASONING_OPTIONS: ReasoningOption[] = [
  { key: 'low', label: '低' },
  { key: 'medium', label: '中' },
  { key: 'high', label: '高' },
]

/**
 * Parse the user-defined reasoning rules text. Format, one rule per line:
 *   <model-match>|<key:label,key:label,...>
 * Example:
 *   deepseek|low:低,medium:中,high:高,max:最大
 *   o3|low:低,medium:中,high:高,minimal:最低
 *   claude|low:低,medium:中,high:高,ultra:极致
 * Lines without a rule separator define model-specific matches that use the
 * default low/medium/high options. Blank lines are ignored.
 */
export function parseReasoningRules(raw: string): ReasoningRule[] {
  const rules: ReasoningRule[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [matchPart, optionsPart] = trimmed.split('|')
    const match = matchPart.trim()
    if (!match) continue
    if (optionsPart === undefined) {
      rules.push({ match, options: DEFAULT_REASONING_OPTIONS })
      continue
    }
    const options = optionsPart
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [key, label] = item.split(':').map((part) => part.trim())
        return { key, label: label || key }
      })
      .filter((item) => item.key)
    if (options.length === 0) {
      rules.push({ match, options: DEFAULT_REASONING_OPTIONS })
      continue
    }
    rules.push({ match, options })
  }
  return rules
}

/** Find the reasoning options that apply to the given model name. */
export function reasoningOptionsForModel(
  raw: string,
  model: string,
): ReasoningOption[] | undefined {
  const rules = parseReasoningRules(raw)
  const lowerModel = model.trim().toLowerCase()
  const matched = rules.find((rule) => lowerModel.includes(rule.match.toLowerCase()))
  return matched?.options
}
