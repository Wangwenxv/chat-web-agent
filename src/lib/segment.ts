export function segmentSentences(input: string): string[] {
  const text = input.trim()
  if (text.length === 0) return []
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('zh-CN', { granularity: 'sentence' })
    : null
  if (segmenter !== null) {
    const output = Array.from(segmenter.segment(text), item => item.segment.trim()).filter(Boolean)
    if (output.length > 0) return output
  }
  return text
    .split(/(?<=[。！？!?\.])\s*/g)
    .map(part => part.trim())
    .filter(Boolean)
}
