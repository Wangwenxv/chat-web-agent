import { unzipSync, zipSync } from 'fflate'
import type { WorkspaceFile, WorkspaceRecord } from '../types'

export function downloadFile(file: WorkspaceFile): void {
  const blob = new Blob([file.content], { type: mimeFor(file.path) })
  triggerDownload(blob, file.path.split('/').pop() || 'file.txt')
}

export function downloadWorkspaceZip(workspace: WorkspaceRecord, files: WorkspaceFile[]): void {
  const manifest = {
    format: 'chat-web-agent-workspace',
    version: 1,
    title: workspace.title,
    entryPath: workspace.entryPath,
    exportedAt: new Date().toISOString(),
    files: files.map((file) => ({
      path: file.path,
      language: file.language,
      revision: file.revision,
    })),
  }
  const encoder = new TextEncoder()
  const archive = zipSync(
    {
      'manifest.json': encoder.encode(JSON.stringify(manifest, null, 2)),
      ...Object.fromEntries(files.map((file) => [file.path, encoder.encode(file.content)])),
    },
    { level: 6 },
  )
  triggerDownload(
    new Blob([archive], { type: 'application/zip' }),
    safeName(workspace.title) + '.zip',
  )
}

export interface ImportedWorkspace {
  title: string
  entryPath: string
  files: { path: string; content: string }[]
}

export interface ImportError {
  message: string
  detail?: string
}

export function parseWorkspaceZip(file: File): Promise<ImportedWorkspace> {
  return new Promise((resolve, reject) => {
    if (file.size > 20 * 1024 * 1024) {
      reject({
        message: 'ZIP is too large',
        detail: 'Imports are limited to 20 MiB.',
      } satisfies ImportError)
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject({ message: 'Unable to read the ZIP file' } satisfies ImportError)
    reader.onload = () => {
      try {
        resolve(inspectZip(new Uint8Array(reader.result as ArrayBuffer)))
      } catch (cause) {
        if (cause && typeof cause === 'object' && 'message' in cause) reject(cause)
        else
          reject({
            message: 'Invalid ZIP file',
            detail: cause instanceof Error ? cause.message : String(cause),
          } satisfies ImportError)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

const ALLOWED_IMPORT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.svg',
  '.md',
  '.txt',
  '.ts',
  '.tsx',
])

function inspectZip(data: Uint8Array): ImportedWorkspace {
  const decoded = unzipSync(data, {
    filter: (item) => !item.name.startsWith('__MACOSX/') && !item.name.endsWith('/'),
  })
  const entries = Object.entries(decoded)
  if (entries.length > 1000)
    throw {
      message: 'Too many files in ZIP',
      detail: 'The workspace limit is 1,000 files.',
    } satisfies ImportError
  const decoder = new TextDecoder()
  const files: { path: string; content: string }[] = []
  let title = 'Imported workspace'
  let entryPath = 'index.html'
  const manifest = entries.find(([name]) => name === 'manifest.json')
  if (manifest) {
    try {
      const parsed = JSON.parse(decoder.decode(manifest[1])) as {
        title?: unknown
        entryPath?: unknown
      }
      if (typeof parsed.title === 'string' && parsed.title.trim())
        title = parsed.title.trim().slice(0, 80)
      if (typeof parsed.entryPath === 'string') entryPath = parsed.entryPath
    } catch {
      /* ignore broken manifest */
    }
  }
  let totalBytes = 0
  for (const [name, bytes] of entries) {
    if (name === 'manifest.json' || name === 'README.md') {
      if (name === 'README.md') files.push({ path: name, content: decoder.decode(bytes) })
      continue
    }
    const extension = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? ''
    if (!ALLOWED_IMPORT_EXTENSIONS.has(extension)) {
      throw {
        message: 'Unsupported file in ZIP',
        detail: `${name}: extension ${extension || '(none)'} is not allowed.`,
      } satisfies ImportError
    }
    const content = decoder.decode(bytes)
    totalBytes += content.length
    if (content.length > 1_048_576)
      throw {
        message: 'File too large in ZIP',
        detail: `${name} exceeds the 1 MiB per-file limit.`,
      } satisfies ImportError
    if (totalBytes > 10 * 1024 * 1024)
      throw {
        message: 'ZIP content is too large',
        detail: 'The workspace limit is 10 MiB of text content.',
      } satisfies ImportError
    files.push({ path: name, content })
  }
  if (files.length === 0) throw { message: 'ZIP contains no usable files' } satisfies ImportError
  if (!files.some((file) => file.path === entryPath || /\.html$/i.test(file.path))) {
    throw {
      message: 'ZIP has no HTML entry',
      detail: 'The preview needs an index.html or another .html file.',
    } satisfies ImportError
  }
  return { title, entryPath, files }
}

function mimeFor(path: string): string {
  const extension = path.toLowerCase().split('.').pop()
  if (extension === 'html' || extension === 'htm') return 'text/html;charset=utf-8'
  if (extension === 'css') return 'text/css;charset=utf-8'
  if (extension === 'js' || extension === 'mjs' || extension === 'ts' || extension === 'tsx')
    return 'text/javascript;charset=utf-8'
  if (extension === 'json') return 'application/json;charset=utf-8'
  if (extension === 'svg') return 'image/svg+xml'
  return 'text/plain;charset=utf-8'
}

function safeName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace'
  )
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
