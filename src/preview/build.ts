import type { PreviewArtifact, PreviewDiagnostic, WorkspaceFile } from '../types'
import { dirname, joinPath, normalizeWorkspacePath } from '../lib/path'

const BRIDGE_SOURCE = [
  '(function () {',
  '  function send(level, message, detail) {',
  '    try { window.parent.postMessage({ source: "chat-web-agent-preview", type: "diagnostic", level: level, message: String(message), detail: detail ? String(detail) : undefined }, "*"); } catch (_) {}',
  '  }',
  '  window.addEventListener("error", function (event) { send("error", event.message || "Preview runtime error", (event.error && event.error.stack) || ""); });',
  '  window.addEventListener("unhandledrejection", function (event) { send("error", "Unhandled promise rejection", event.reason && event.reason.stack ? event.reason.stack : event.reason); });',
  '}());',
].join('\n')

export function buildPreview(files: WorkspaceFile[], entryPath = 'index.html'): PreviewArtifact {
  const diagnostics: PreviewDiagnostic[] = []
  const byPath = new Map(files.map(file => [file.path, file]))
  const entry = byPath.get(entryPath) ?? files.find(file => file.kind === 'html')
  if (!entry) {
    diagnostics.push({ level: 'error', message: 'No HTML entry file found', detail: 'Create an index.html file in the virtual workspace.' })
    return { srcdoc: emptyDocument(diagnostics), diagnostics }
  }
  if (entry.kind !== 'html') {
    diagnostics.push({ level: 'error', message: entry.path + ' is not an HTML file' })
    return { srcdoc: emptyDocument(diagnostics), diagnostics, entryPath: entry.path }
  }
  for (const file of files) {
    if (file.kind === 'typescript') diagnostics.push({ level: 'warn', message: file.path + ' is stored but not compiled in the browser preview' })
  }
  let html = entry.content
  if (!/<html[\s>]/i.test(html)) html = '<!doctype html><html><head></head><body>' + html + '</body></html>'
  const entryDir = dirname(entry.path)
  html = html.replace(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi, (full, href: string) => {
    const target = resolveAsset(entryDir, href)
    const css = target ? byPath.get(target) : undefined
    if (css?.kind === 'css') return '<style data-workspace-file="' + escapeAttribute(css.path) + '">\n' + escapeStyle(css.content) + '\n</style>'
    if (/^https?:\/\//i.test(href)) {
      diagnostics.push({ level: 'warn', message: 'External stylesheet removed from preview', detail: href })
      return ''
    }
    return full
  })
  html = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (full, _before: string, src: string, _after: string) => {
    const target = resolveAsset(entryDir, src)
    const js = target ? byPath.get(target) : undefined
    if (js?.kind === 'javascript') return '<script data-workspace-file="' + escapeAttribute(js.path) + '">\n' + escapeScript(js.content) + '\n</script>'
    if (/^https?:\/\//i.test(src)) {
      diagnostics.push({ level: 'warn', message: 'External script removed from preview', detail: src })
      return ''
    }
    if (js?.kind === 'typescript') {
      diagnostics.push({ level: 'warn', message: src + ' is TypeScript and cannot run without a browser compiler' })
      return ''
    }
    return full
  })
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; base-uri \'none\'; form-action \'none\';">'
  const bridge = '<script data-preview-bridge>' + escapeScript(BRIDGE_SOURCE) + '</script>'
  if (/<head[\s>]/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1>' + csp + bridge)
  else html = csp + bridge + html
  const knownScripts = new Set(Array.from(byPath.values()).filter(file => file.kind === 'javascript').map(file => file.path))
  const referencedScripts = new Set(Array.from(html.matchAll(/data-workspace-file="([^"]+)"/g), match => match[1]))
  const unusedScripts = [...knownScripts].filter(path => !referencedScripts.has(path))
  if (unusedScripts.length > 0) {
    html = html.replace(/<\/body>/i, unusedScripts.map(path => '<script data-workspace-file="' + escapeAttribute(path) + '">\n' + escapeScript(byPath.get(path)?.content ?? '') + '\n</script>').join('') + '</body>')
  }
  return { srcdoc: html, diagnostics, entryPath: entry.path }
}

function resolveAsset(base: string, value: string): string | null {
  if (/^(data:|blob:|https?:|#)/i.test(value)) return null
  return normalizeWorkspacePath(joinPath(base, value))
}

function emptyDocument(diagnostics: PreviewDiagnostic[]): string {
  const details = diagnostics.map(item => '<p><strong>' + escapeHtml(item.message) + '</strong><br>' + escapeHtml(item.detail ?? '') + '</p>').join('')
  return '<!doctype html><html><head><meta charset="UTF-8"></head><body style="font-family:system-ui;padding:32px">' + details + '</body></html>'
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

function escapeStyle(value: string): string {
  return value.replaceAll('</style', '<\\/style')
}

function escapeScript(value: string): string {
  return value.replaceAll('</script', '<\\/script')
}

