import { diffLines } from 'diff'

export interface DiffLine {
  type: 'added' | 'removed' | 'neutral'
  value: string
}

export function buildLineDiff(before: string, after: string): DiffLine[] {
  return diffLines(before, after).flatMap((part) => {
    const lines = part.value.split('\n')
    if (lines.length === 0) return []
    if (lines[lines.length - 1] === '') lines.pop()
    return lines.map((line): DiffLine => ({
      type: part.added ? 'added' : part.removed ? 'removed' : 'neutral',
      value: line,
    }))
  })
}
