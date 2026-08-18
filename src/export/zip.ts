import { zipSync } from 'fflate'
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
    files: files.map(file => ({ path: file.path, language: file.language, revision: file.revision })),
  }
  const encoder = new TextEncoder()
  const archive = zipSync({
    'manifest.json': encoder.encode(JSON.stringify(manifest, null, 2)),
    ...Object.fromEntries(files.map(file => [file.path, encoder.encode(file.content)])),
  }, { level: 6 })
  triggerDownload(new Blob([archive], { type: 'application/zip' }), safeName(workspace.title) + '.zip')
}

function mimeFor(path: string): string {
  const extension = path.toLowerCase().split('.').pop()
  if (extension === 'html' || extension === 'htm') return 'text/html;charset=utf-8'
  if (extension === 'css') return 'text/css;charset=utf-8'
  if (extension === 'js' || extension === 'mjs' || extension === 'ts' || extension === 'tsx') return 'text/javascript;charset=utf-8'
  if (extension === 'json') return 'application/json;charset=utf-8'
  if (extension === 'svg') return 'image/svg+xml'
  return 'text/plain;charset=utf-8'
}

function safeName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

