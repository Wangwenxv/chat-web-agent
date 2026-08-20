import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileText,
  GitCompare,
  LoaderCircle,
  Save,
} from 'lucide-react'
import type { PreviewDiagnostic, WorkspaceFile } from '../../types'
import { buildLineDiff } from '../../lib/diff'

export function SourcePanel({
  file,
  files,
  onSelectFile,
  onSave,
}: {
  file?: WorkspaceFile
  files: WorkspaceFile[]
  onSelectFile: (path: string) => void
  onSave: (file: WorkspaceFile, content: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(file?.content ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setDraft(file?.content ?? '')
    setSaveState('idle')
    setSaveError('')
  }, [file?.path, file?.revision, file?.content])

  const dirty = !!file && draft !== file.content
  const save = async () => {
    if (!file || !dirty || saveState === 'saving') return
    setSaveState('saving')
    setSaveError('')
    try {
      await onSave(file, draft)
      setSaveState('saved')
      window.setTimeout(
        () => setSaveState((current) => (current === 'saved' ? 'idle' : current)),
        1200,
      )
    } catch (error) {
      setSaveState('error')
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="inspector-content source-content">
      <div className="source-heading">
        <label className="source-file-picker">
          <span className="sr-only">选择源码文件</span>
          <select
            className="source-file-select"
            value={file?.path ?? ''}
            onChange={(event) => onSelectFile(event.target.value)}
            disabled={files.length === 0 || dirty}
            title={dirty ? '请先保存或撤销当前修改' : '选择源码文件'}
          >
            {files.length === 0 && <option value="">暂无文件</option>}
            {files.map((item) => (
              <option key={item.path} value={item.path}>
                {item.path} · r{item.revision}
              </option>
            ))}
          </select>
        </label>
        <div className="source-actions">
          {dirty && <span className="source-dirty">未保存</span>}
          <button
            className="source-save-button"
            disabled={!dirty || saveState === 'saving'}
            onClick={() => void save()}
            title="保存源码"
          >
            {saveState === 'saving' ? (
              <LoaderCircle className="spin" size={13} />
            ) : saveState === 'saved' ? (
              <Check size={13} />
            ) : (
              <Save size={13} />
            )}
            <span>
              {saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : '保存'}
            </span>
          </button>
        </div>
      </div>
      {file ? (
        <textarea
          className="source-editor"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setSaveState('idle')
            setSaveError('')
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              void save()
            }
          }}
          spellCheck={false}
          aria-label={`${file.path} 源码编辑器`}
        />
      ) : (
        <div className="empty-inspector">
          <FileText size={22} />
          <strong>请选择一个文件</strong>
          <span>源码会与虚拟工作台实时同步。</span>
        </div>
      )}
      {saveError && (
        <div className="source-save-error">
          <AlertTriangle size={13} />
          <span>{saveError}</span>
        </div>
      )}
    </div>
  )
}

export function ProblemsPanel({ diagnostics }: { diagnostics: PreviewDiagnostic[] }) {
  return (
    <div className="inspector-content problems-content">
      {diagnostics.length === 0 ? (
        <div className="empty-inspector">
          <CheckCircle2 size={22} />
          <strong>未检测到问题</strong>
          <span>最近一次预览构建没有报错。</span>
        </div>
      ) : (
        diagnostics.map((item, index) => (
          <div className={'problem-item ' + item.level} key={item.message + index}>
            {item.level === 'error' ? (
              <AlertTriangle size={15} />
            ) : (
              <CircleIcon level={item.level} />
            )}
            <div>
              <strong>{item.message}</strong>
              {item.detail && <pre>{item.detail}</pre>}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function CircleIcon({ level }: { level: 'info' | 'warn' }) {
  return level === 'warn' ? <AlertTriangle size={15} /> : <span className="info-icon">i</span>
}

export function DiffPanel({
  file,
  revisions,
}: {
  file?: WorkspaceFile
  revisions: { revision: number; content: string; createdAt: number }[]
}) {
  if (!file)
    return (
      <div className="inspector-content empty-inspector">
        <FileText size={22} />
        <strong>请选择一个文件</strong>
      </div>
    )
  const previous = revisions.find((item) => item.revision === file.revision - 1)
  const lines = previous ? buildLineDiff(previous.content, file.content) : []
  return (
    <div className="inspector-content diff-content">
      <div className="diff-heading">
        <span>{file.path}</span>
        <span>r{file.revision}</span>
      </div>
      {previous ? (
        <pre className="diff-view">
          {lines.map((line, index) => (
            <span className={'diff-line ' + line.type} key={index}>
              <b>{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</b>
              {line.value || ' '}
              {'\n'}
            </span>
          ))}
        </pre>
      ) : (
        <div className="empty-inspector compact">
          <GitCompare size={20} />
          <span>该文件没有更早的版本。</span>
        </div>
      )}
    </div>
  )
}
