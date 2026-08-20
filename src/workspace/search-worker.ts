import type { GrepQuery, GrepResult } from './repository'

let files: { path: string; content: string }[] = []
let cacheToken: unknown

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function run(query: GrepQuery): GrepResult {
  const started = performance.now()
  let matcher: RegExp
  try {
    matcher = new RegExp(
      query.useRegex ? query.pattern : escapeRegExp(query.pattern),
      query.caseSensitive ? 'g' : 'gi',
    )
  } catch (error) {
    return {
      matches: [],
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: 0,
    }
  }
  const matches: { path: string; line: number; text: string }[] = []
  for (const file of files) {
    if (query.pathFilter && !file.path.startsWith(query.pathFilter)) continue
    const lines = file.content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      matcher.lastIndex = 0
      if (matcher.test(lines[index])) {
        matches.push({ path: file.path, line: index + 1, text: lines[index].trim().slice(0, 400) })
        if (matches.length >= query.maxResults) {
          return { matches, truncated: true, elapsedMs: Math.round(performance.now() - started) }
        }
      }
    }
  }
  return { matches, truncated: false, elapsedMs: Math.round(performance.now() - started) }
}

self.onmessage = (
  event: MessageEvent<
    | { type: 'load'; token: unknown; files: { path: string; content: string }[] }
    | { type: 'search'; token: unknown; query: GrepQuery }
  >,
) => {
  const message = event.data
  if (message.type === 'load') {
    files = message.files
    cacheToken = message.token
    return
  }
  if (message.type === 'search') {
    if (cacheToken !== message.token || files.length === 0) {
      self.postMessage({
        type: 'result',
        id: 0,
        error: 'workspace file cache is not loaded yet',
        result: undefined,
      })
      return
    }
    self.postMessage({ type: 'result', id: 0, result: run(message.query), error: undefined })
  }
}
