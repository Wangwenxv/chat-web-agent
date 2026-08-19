import { AlertTriangle, CheckCircle2, Code2, FileText, GitCompare } from 'lucide-react'
import type { PreviewDiagnostic, WorkspaceFile } from '../../types'
import { buildLineDiff } from '../../lib/diff'

export function SourcePanel({ file, files, onSelectFile }: { file?: WorkspaceFile; files: WorkspaceFile[]; onSelectFile: (path: string) => void }) {
  return (
    <div className="inspector-content source-content">
      <div className="source-heading">
        <span className="toolbar-title"><Code2 size={13} />源码</span>
        <label className="source-file-picker">
          <span className="sr-only">选择源码文件</span>
          <select className="source-file-select" value={file?.path ?? ''} onChange={event => onSelectFile(event.target.value)} disabled={files.length === 0}>
            {files.length === 0 && <option value="">暂无文件</option>}
            {files.map(item => <option key={item.path} value={item.path}>{item.path} · r{item.revision}</option>)}
          </select>
        </label>
      </div>
      {file
        ? <pre className="source-view"><code>{file.content}</code></pre>
        : <div className="empty-inspector"><FileText size={22} /><strong>请选择一个文件</strong><span>源码会与虚拟工作台实时同步。</span></div>}
    </div>
  )
}

export function ProblemsPanel({ diagnostics }: { diagnostics: PreviewDiagnostic[] }) {
  return (
    <div className="inspector-content problems-content">
      {diagnostics.length === 0
        ? <div className="empty-inspector"><CheckCircle2 size={22} /><strong>未检测到问题</strong><span>最近一次预览构建没有报错。</span></div>
        : diagnostics.map((item, index) => (
          <div className={'problem-item ' + item.level} key={item.message + index}>
            {item.level === 'error' ? <AlertTriangle size={15} /> : <CircleIcon level={item.level} />}
            <div><strong>{item.message}</strong>{item.detail && <pre>{item.detail}</pre>}</div>
          </div>
        ))}
    </div>
  )
}

function CircleIcon({ level }: { level: 'info' | 'warn' }) {
  return level === 'warn' ? <AlertTriangle size={15} /> : <span className="info-icon">i</span>
}

export function DiffPanel({ file, revisions }: { file?: WorkspaceFile; revisions: Array<{ revision: number; content: string; createdAt: number }> }) {
  if (!file) return <div className="inspector-content empty-inspector"><FileText size={22} /><strong>请选择一个文件</strong></div>
  const previous = revisions.find(item => item.revision === file.revision - 1)
  const lines = previous ? buildLineDiff(previous.content, file.content) : []
  return (
    <div className="inspector-content diff-content">
      <div className="diff-heading"><span>{file.path}</span><span>r{file.revision}</span></div>
      {previous
        ? <pre className="diff-view">{lines.map((line, index) => <span className={'diff-line ' + line.type} key={index}><b>{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</b>{line.value || ' '}{'\n'}</span>)}</pre>
        : <div className="empty-inspector compact"><GitCompare size={20} /><span>该文件没有更早的版本。</span></div>}
    </div>
  )
}
