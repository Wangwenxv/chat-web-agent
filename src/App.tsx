import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Code2,
  Download,
  Eye,
  FileCode2,
  FileText,
  FolderPlus,
  GitCompare,
  LoaderCircle,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import type {
  AgentEventRecord,
  AgentSettings,
  ChatMessageRecord,
  PreviewDiagnostic,
  SessionRecord,
  ToolCallRequest,
  ToolExecutionResult,
  WorkspaceFile,
  WorkspaceRecord,
} from './types'
import { segmentSentences } from './lib/segment'
import { buildLineDiff } from './lib/diff'
import { buildPreview } from './preview/build'
import { downloadFile, downloadWorkspaceZip } from './export/zip'
import { getToolCallSummary, runUserTurn } from './agent/runner'
import { BrowserRepository } from './workspace/repository'

type InspectorTab = 'preview' | 'problems' | 'diff'

const repository = new BrowserRepository()

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceRecord>()
  const [session, setSession] = useState<SessionRecord>()
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [messages, setMessages] = useState<ChatMessageRecord[]>([])
  const [events, setEvents] = useState<AgentEventRecord[]>([])
  const [settings, setSettings] = useState<AgentSettings>()
  const [selectedPath, setSelectedPath] = useState('index.html')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('preview')
  const [previewDiagnostics, setPreviewDiagnostics] = useState<PreviewDiagnostic[]>([])
  const [revisionHistory, setRevisionHistory] = useState<Array<{ revision: number; content: string; createdAt: number }>>([])
  const [editorValue, setEditorValue] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController>()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const selectedFile = files.find(file => file.path === selectedPath) ?? files[0]
  const artifact = useMemo(() => buildPreview(files, workspace?.entryPath ?? 'index.html'), [files, workspace?.entryPath])
  const diagnostics = [...artifact.diagnostics, ...previewDiagnostics]

  const reload = useCallback(async (workspaceId: string, sessionId: string) => {
    const [nextFiles, nextMessages, nextEvents] = await Promise.all([
      repository.listFiles(workspaceId),
      repository.listMessages(sessionId),
      repository.listEvents(sessionId),
    ])
    setFiles(nextFiles)
    setMessages(nextMessages)
    setEvents(nextEvents)
    setSelectedPath(current => nextFiles.some(file => file.path === current) ? current : nextFiles[0]?.path ?? 'index.html')
  }, [])

  const bootstrap = useCallback(async () => {
    try {
      const nextWorkspace = await repository.ensureWorkspace()
      const nextSession = await repository.getOrCreateSession(nextWorkspace.id)
      const [nextWorkspaces, nextSettings] = await Promise.all([repository.listWorkspaces(), repository.getSettings()])
      setWorkspace(nextWorkspace)
      setSession(nextSession)
      setWorkspaces(nextWorkspaces)
      setSettings(nextSettings)
      await reload(nextWorkspace.id, nextSession.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [reload])

  useEffect(() => { void bootstrap() }, [bootstrap])

  useEffect(() => {
    setEditorValue(selectedFile?.content ?? '')
    setRevisionHistory([])
    if (workspace && selectedFile) {
      void repository.listRevisions(workspace.id, selectedFile.path).then(setRevisionHistory).catch(() => setRevisionHistory([]))
    }
  }, [selectedFile?.path, selectedFile?.revision, workspace])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (!event.data || typeof event.data !== 'object') return
      const payload = event.data as { source?: unknown; type?: unknown; level?: unknown; message?: unknown; detail?: unknown }
      if (payload.source !== 'chat-web-agent-preview' || payload.type !== 'diagnostic') return
      if (payload.level !== 'info' && payload.level !== 'warn' && payload.level !== 'error') return
      setPreviewDiagnostics(current => [...current.slice(-19), {
        level: payload.level,
        message: typeof payload.message === 'string' ? payload.message : 'Preview diagnostic',
        detail: typeof payload.detail === 'string' ? payload.detail : undefined,
      }])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    setPreviewDiagnostics([])
  }, [artifact.srcdoc])

  const handleEvent = useCallback(async (event: AgentEventRecord) => {
    setEvents(current => current.some(item => item.id === event.id) ? current : [...current, event])
    if (workspace && (event.type === 'workspace_mutation' || event.type === 'tool_result')) {
      const nextFiles = await repository.listFiles(workspace.id)
      setFiles(nextFiles)
    }
  }, [workspace])

  const handleSend = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || !workspace || !session || !settings || running) return
    setInputValue('')
    setError('')
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await runUserTurn({
        repository,
        workspaceId: workspace.id,
        sessionId: session.id,
        settings,
        text,
        signal: controller.signal,
        onEvent: handleEvent,
      })
      await reload(workspace.id, session.id)
      const nextWorkspace = await repository.getWorkspace(workspace.id)
      if (nextWorkspace) setWorkspace(nextWorkspace)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause))
      await reload(workspace.id, session.id)
    } finally {
      abortRef.current = undefined
      setRunning(false)
    }
  }, [handleEvent, inputValue, reload, running, session, settings, workspace])

  const handleNewWorkspace = useCallback(async () => {
    const title = window.prompt('Workspace name', 'New web workspace')?.trim()
    if (!title) return
    const nextWorkspace = await repository.createWorkspace(title)
    await repository.writeFile(nextWorkspace.id, 'index.html', '<!doctype html><html><head><meta charset="UTF-8"><title>New page</title></head><body><main><h1>New page</h1></main></body></html>')
    const nextSession = await repository.createSession(nextWorkspace.id)
    setWorkspace(nextWorkspace)
    setSession(nextSession)
    setWorkspaces(await repository.listWorkspaces())
    await reload(nextWorkspace.id, nextSession.id)
  }, [reload])

  const handleSwitchWorkspace = useCallback(async (workspaceId: string) => {
    const nextWorkspace = await repository.getWorkspace(workspaceId)
    if (!nextWorkspace) return
    const nextSession = await repository.getOrCreateSession(workspaceId)
    setWorkspace(nextWorkspace)
    setSession(nextSession)
    setSelectedPath(nextWorkspace.entryPath)
    await reload(nextWorkspace.id, nextSession.id)
  }, [reload])

  const handleSaveFile = useCallback(async () => {
    if (!workspace || !selectedFile) return
    try {
      setError('')
      await repository.writeFile(workspace.id, selectedFile.path, editorValue, selectedFile.revision)
      await reload(workspace.id, session?.id ?? '')
      setInspectorTab('preview')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [editorValue, reload, selectedFile, session?.id, workspace])

  const handleSettingsSave = useCallback(async (nextSettings: AgentSettings) => {
    await repository.saveSettings(nextSettings)
    setSettings(nextSettings)
    setSettingsOpen(false)
  }, [])

  if (loading) return <div className="loading-screen"><LoaderCircle className="spin" size={20} /><span>Loading browser workspace</span></div>
  if (error && !workspace) return <div className="loading-screen error-screen"><AlertTriangle size={20} /><span>{error}</span></div>
  if (!workspace || !session || !settings) return null

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Bot size={17} /></span>
          <span className="brand-name">DeepSeek Harness</span>
          <span className="brand-divider">/</span>
          <span className="brand-product">Browser Agent</span>
        </div>
        <div className="topbar-workspace">
          <span className="live-dot" />
          <span>{workspace.title}</span>
          <span className="local-badge">LOCAL</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="Export workspace as ZIP" onClick={() => downloadWorkspaceZip(workspace, files)}><Download size={16} /></button>
          <button className="icon-button" title="Open settings" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /></button>
        </div>
      </header>

      <main className="workbench">
        <aside className="sidebar">
          <div className="sidebar-section workspace-section">
            <div className="section-label"><span>WORKSPACE</span><button className="mini-button" title="New workspace" onClick={() => void handleNewWorkspace()}><Plus size={14} /></button></div>
            <label className="workspace-select">
              <Sparkles size={14} />
              <select value={workspace.id} onChange={event => void handleSwitchWorkspace(event.target.value)}>
                {workspaces.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
            <div className="workspace-meta"><span>{files.length} files</span><span>IndexedDB</span></div>
          </div>
          <div className="sidebar-section file-section">
            <div className="section-label"><span>FILES</span><span className="muted-count">{files.length}</span></div>
            <div className="file-list">
              {files.map(file => (
                <button className={'file-row' + (selectedFile?.path === file.path ? ' is-selected' : '')} key={file.path} onClick={() => setSelectedPath(file.path)}>
                  {file.kind === 'html' ? <Code2 size={15} /> : file.kind === 'css' ? <FileCode2 size={15} /> : file.kind === 'javascript' ? <Play size={14} /> : <FileText size={15} />}
                  <span className="file-name">{file.path}</span>
                  <span className="file-revision">r{file.revision}</span>
                </button>
              ))}
            </div>
            <div className="sidebar-note"><span className="note-line" /><span>Only virtual web files are available to the agent.</span></div>
          </div>
          <div className="sidebar-footer">
            <button className="sidebar-action" onClick={() => void handleNewWorkspace()}><FolderPlus size={15} /><span>New workspace</span></button>
            <button className="sidebar-action" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /><span>Settings</span></button>
          </div>
        </aside>

        <section className="conversation-panel">
          <div className="panel-heading conversation-heading">
            <div><span className="eyebrow">SESSION</span><h1>{session.title}</h1></div>
            <div className="model-chip"><span className={settings.demoMode ? 'mode-dot demo' : 'mode-dot'} />{settings.demoMode ? 'Demo model' : settings.model}</div>
          </div>
          <div className="message-scroll">
            {messages.length === 0 && <EmptyConversation onPrompt={setInputValue} />}
            {messages.map(message => <MessageView key={message.id} message={message} events={events} segmented={settings.segmentResponses} />)}
            {running && <div className="thinking-row"><LoaderCircle size={15} className="spin" /><span>Working in the browser workspace</span></div>}
            {error && <div className="inline-error"><AlertTriangle size={15} /><span>{error}</span><button className="icon-button tiny" title="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}
          </div>
          <form className="composer" onSubmit={event => { event.preventDefault(); void handleSend() }}>
            <div className="composer-shell">
              <textarea value={inputValue} onChange={event => setInputValue(event.target.value)} placeholder="Ask the agent to change the page or inspect the workspace..." rows={2} disabled={running} />
              <div className="composer-tools">
                <span className="composer-hint"><Wrench size={13} /> tools run in this workspace</span>
                {running
                  ? <button type="button" className="send-button stop" title="Stop current turn" onClick={() => abortRef.current?.abort()}><Square size={15} fill="currentColor" /></button>
                  : <button type="submit" className="send-button" title="Send message" disabled={!inputValue.trim()}><Send size={16} /></button>}
              </div>
            </div>
          </form>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs" role="tablist">
            <button className={inspectorTab === 'preview' ? 'active' : ''} onClick={() => setInspectorTab('preview')}><Eye size={15} />Preview</button>
            <button className={inspectorTab === 'problems' ? 'active' : ''} onClick={() => setInspectorTab('problems')}><AlertTriangle size={15} />Problems{diagnostics.length > 0 && <span className="tab-count">{diagnostics.length}</span>}</button>
            <button className={inspectorTab === 'diff' ? 'active' : ''} onClick={() => setInspectorTab('diff')}><GitCompare size={15} />Diff</button>
          </div>
          {inspectorTab === 'preview' && <PreviewPanel artifact={artifact} iframeRef={iframeRef} onRefresh={() => setPreviewDiagnostics([])} />}
          {inspectorTab === 'problems' && <ProblemsPanel diagnostics={diagnostics} />}
          {inspectorTab === 'diff' && <DiffPanel file={selectedFile} revisions={revisionHistory} />}
          <EditorPanel file={selectedFile} value={editorValue} onChange={setEditorValue} onSave={() => void handleSaveFile()} onDownload={() => selectedFile && downloadFile(selectedFile)} />
        </aside>
      </main>

      {settingsOpen && <SettingsModal value={settings} onClose={() => setSettingsOpen(false)} onSave={next => void handleSettingsSave(next)} />}
    </div>
  )
}

function EmptyConversation({ onPrompt }: { onPrompt: (value: string) => void }) {
  const prompts = ['做一个有悬浮交互的首页', '搜索一下浏览器 Agent 的最新资料', '读取当前文件并告诉我哪里可以改进']
  return (
    <div className="empty-conversation">
      <div className="empty-orbit"><Bot size={28} /></div>
      <h2>What are we making?</h2>
      <p>Start with a small web idea. The agent can read, write, search, and explain the virtual workspace.</p>
      <div className="prompt-grid">{prompts.map(prompt => <button key={prompt} onClick={() => onPrompt(prompt)}>{prompt}<span>↗</span></button>)}</div>
    </div>
  )
}

function MessageView({ message, events, segmented }: { message: ChatMessageRecord; events: AgentEventRecord[]; segmented: boolean }) {
  if (message.role === 'tool') return null
  if (message.role === 'user') return <div className="message-row user-row"><div className="user-bubble">{message.content}</div></div>
  if (message.toolCalls?.length) {
    return (
      <div className="assistant-block">
        {message.content && <div className="assistant-copy">{message.content}</div>}
        <div className="tool-stack">{message.toolCalls.map(call => <ToolCard key={call.id} call={call} events={events} />)}</div>
      </div>
    )
  }
  const segments = segmented ? segmentSentences(message.content) : [message.content]
  return <div className="assistant-block final-answer"><div className="assistant-avatar"><Bot size={15} /></div><div className="assistant-copy">{segments.map((segment, index) => <p className="answer-segment" style={{ animationDelay: index * 45 + 'ms' }} key={segment + index}>{segment}</p>)}</div></div>
}

function ToolCard({ call, events }: { call: ToolCallRequest; events: AgentEventRecord[] }) {
  const event = events.find(item => item.type === 'tool_result' && (item.payload as { callId?: string }).callId === call.id)
  const result = event?.payload as { result?: ToolExecutionResult } | undefined
  const ok = result?.result?.ok
  return (
    <details className={'tool-card' + (ok === false ? ' failed' : '')} open={ok === false}>
      <summary><span className="tool-icon"><Wrench size={14} /></span><span className="tool-name">{getToolCallSummary(call)}</span><span className="tool-status">{event ? (ok === false ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />) : <LoaderCircle size={14} className="spin" />}</span><ChevronDown size={14} className="tool-chevron" /></summary>
      {result?.result && <pre>{result.result.content.slice(0, 2800)}</pre>}
    </details>
  )
}

function PreviewPanel({ artifact, iframeRef, onRefresh }: { artifact: ReturnType<typeof buildPreview>; iframeRef: RefObject<HTMLIFrameElement | null>; onRefresh: () => void }) {
  return (
    <div className="inspector-content preview-content">
      <div className="inspector-toolbar"><span className="toolbar-title"><span className="preview-pulse" />Live preview</span><button className="icon-button tiny" title="Rebuild preview" onClick={onRefresh}><RefreshCw size={14} /></button></div>
      <div className="preview-frame-wrap"><iframe ref={iframeRef} title="Sandboxed project preview" sandbox="allow-scripts" srcDoc={artifact.srcdoc} /></div>
    </div>
  )
}

function ProblemsPanel({ diagnostics }: { diagnostics: PreviewDiagnostic[] }) {
  return <div className="inspector-content problems-content">{diagnostics.length === 0 ? <div className="empty-inspector"><CheckCircle2 size={22} /><strong>No problems detected</strong><span>The last preview build is quiet.</span></div> : diagnostics.map((item, index) => <div className={'problem-item ' + item.level} key={item.message + index}>{item.level === 'error' ? <AlertTriangle size={15} /> : <CircleIcon level={item.level} />}<div><strong>{item.message}</strong>{item.detail && <pre>{item.detail}</pre>}</div></div>)}</div>
}

function CircleIcon({ level }: { level: 'info' | 'warn' }) {
  return level === 'warn' ? <AlertTriangle size={15} /> : <span className="info-icon">i</span>
}

function DiffPanel({ file, revisions }: { file?: WorkspaceFile; revisions: Array<{ revision: number; content: string; createdAt: number }> }) {
  if (!file) return <div className="inspector-content empty-inspector"><FileText size={22} /><strong>Select a file</strong></div>
  const previous = revisions.find(item => item.revision === file.revision - 1)
  const lines = previous ? buildLineDiff(previous.content, file.content) : []
  return <div className="inspector-content diff-content"><div className="diff-heading"><span>{file.path}</span><span>r{file.revision}</span></div>{previous ? <pre className="diff-view">{lines.map((line, index) => <span className={'diff-line ' + line.type} key={index}><b>{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</b>{line.value || ' '}{'\n'}</span>)}</pre> : <div className="empty-inspector compact"><GitCompare size={20} /><span>No previous revision for this file.</span></div>}</div>
}

function EditorPanel({ file, value, onChange, onSave, onDownload }: { file?: WorkspaceFile; value: string; onChange: (value: string) => void; onSave: () => void; onDownload: () => void }) {
  return (
    <div className="editor-panel">
      <div className="editor-heading"><div><Code2 size={14} /><span>{file?.path ?? 'No file selected'}</span>{file && <span className="editor-revision">r{file.revision}</span>}</div><div className="editor-actions"><button className="icon-button tiny" title="Download file" disabled={!file} onClick={onDownload}><Download size={14} /></button><button className="save-button" disabled={!file} onClick={onSave}><CheckCircle2 size={14} />Save</button></div></div>
      <textarea className="code-editor" spellCheck={false} value={value} onChange={event => onChange(event.target.value)} disabled={!file} />
    </div>
  )
}

function SettingsModal({ value, onClose, onSave }: { value: AgentSettings; onClose: () => void; onSave: (value: AgentSettings) => void }) {
  const [draft, setDraft] = useState(value)
  const patch = (next: Partial<AgentSettings>) => setDraft(current => ({ ...current, ...next }))
  return (
    <div className="modal-layer" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="settings-modal">
        <div className="modal-heading"><div><span className="eyebrow">RUNTIME</span><h2>Agent settings</h2></div><button className="icon-button" title="Close settings" onClick={onClose}><X size={17} /></button></div>
        <div className="settings-scroll">
          <label className="setting-toggle"><input type="checkbox" checked={draft.demoMode} onChange={event => patch({ demoMode: event.target.checked })} /><span><strong>Demo model</strong><small>Run a deterministic local model flow without a network request.</small></span></label>
          <label className="field-label">Model API base URL<input value={draft.apiBaseUrl} onChange={event => patch({ apiBaseUrl: event.target.value })} placeholder="https://api.deepseek.com/v1" /></label>
          <label className="field-label">API key<input type="password" value={draft.apiKey} onChange={event => patch({ apiKey: event.target.value })} placeholder="Kept only in this browser" /></label>
          <label className="field-label">Model<input value={draft.model} onChange={event => patch({ model: event.target.value })} placeholder="deepseek-chat" /></label>
          <div className="settings-divider" />
          <label className="field-label">Search provider<select value={draft.searchProvider} onChange={event => patch({ searchProvider: event.target.value as AgentSettings['searchProvider'] })}><option value="disabled">Disabled</option><option value="duckduckgo">DuckDuckGo JSON</option><option value="custom">Custom CORS endpoint</option></select></label>
          {draft.searchProvider === 'custom' && <><label className="field-label">Search endpoint<input value={draft.searchEndpoint} onChange={event => patch({ searchEndpoint: event.target.value })} placeholder="https://example.com/search" /></label><label className="field-label">Search headers<small className="field-hint">JSON object with optional request headers.</small><textarea value={draft.searchHeaders} onChange={event => patch({ searchHeaders: event.target.value })} rows={3} placeholder="{}" /></label></>}
          <label className="setting-toggle"><input type="checkbox" checked={draft.segmentResponses} onChange={event => patch({ segmentResponses: event.target.checked })} /><span><strong>Sentence pacing</strong><small>Render final answers as short sentence units.</small></span></label>
          <label className="setting-toggle"><input type="checkbox" checked={draft.reviewResponses} onChange={event => patch({ reviewResponses: event.target.checked })} /><span><strong>Publish check</strong><small>Reject empty or oversized final responses before they enter the chat.</small></span></label>
          <div className="number-row"><label className="field-label">Max steps<input type="number" min={1} max={20} value={draft.maxSteps} onChange={event => patch({ maxSteps: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label><label className="field-label">Max tool calls<input type="number" min={1} max={50} value={draft.maxToolCalls} onChange={event => patch({ maxToolCalls: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} /></label></div>
        </div>
        <div className="modal-actions"><span className="security-note">API keys never enter preview srcdoc or exported ZIP.</span><button className="primary-button" onClick={() => onSave(draft)}>Save settings</button></div>
      </section>
    </div>
  )
}
