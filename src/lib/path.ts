import type { FileKind } from '../types'

const EXTENSION_KIND: Record<string, { kind: FileKind; language: string; previewable: boolean }> = {
  '.html': { kind: 'html', language: 'html', previewable: true },
  '.htm': { kind: 'html', language: 'html', previewable: true },
  '.css': { kind: 'css', language: 'css', previewable: true },
  '.js': { kind: 'javascript', language: 'javascript', previewable: true },
  '.mjs': { kind: 'javascript', language: 'javascript', previewable: true },
  '.json': { kind: 'json', language: 'json', previewable: true },
  '.svg': { kind: 'svg', language: 'svg', previewable: true },
  '.ts': { kind: 'typescript', language: 'typescript', previewable: false },
  '.tsx': { kind: 'typescript', language: 'typescript', previewable: false },
  '.md': { kind: 'markdown', language: 'markdown', previewable: false },
}

export function normalizeWorkspacePath(input: string): string | null {
  const trimmed = input.trim().replaceAll('\\', '/')
  if (trimmed.length === 0) return null
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) return null
  const parts = trimmed.split('/').filter(Boolean)
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
      continue
    }
    if (/[\0<>:"|?*]/.test(part)) return null
    resolved.push(part)
  }
  const joined = resolved.join('/')
  return joined.length > 0 ? joined : null
}

export function fileMetaFromPath(path: string): { kind: FileKind; language: string; previewable: boolean } {
  const match = /\.[^.]+$/.exec(path.toLowerCase())
  if (match !== null) {
    const meta = EXTENSION_KIND[match[0]]
    if (meta !== undefined) return meta
  }
  return { kind: 'text', language: 'text', previewable: false }
}

export function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

export function dirname(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.length > 0 ? parts.join('/') : ''
}

export function joinPath(...parts: string[]): string {
  return parts
    .map(part => part.replaceAll('\\', '/'))
    .filter(Boolean)
    .join('/')
    .replaceAll(/\/+/g, '/')
}

export function isPreviewablePath(path: string): boolean {
  return fileMetaFromPath(path).previewable
}

export function sortPaths(paths: readonly string[]): string[] {
  return [...paths].sort((a, b) => {
    const aDepth = a.split('/').length
    const bDepth = b.split('/').length
    if (aDepth !== bDepth) return aDepth - bDepth
    return a.localeCompare(b)
  })
}
