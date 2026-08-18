import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bot,
  CheckCircle2,
  ChevronDown,
  Code2,
  Download,
  Eye,
  FileCode2,
  FileText,
  FolderPlus,
  FolderUp,
  GitCompare,
  LoaderCircle,
  ListTree,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
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
import { downloadFile, downloadWorkspaceZip, parseWorkspaceZip } from './export/zip'
import { getToolCallSummary, runUserTurn } from './agent/runner'
import { fetchModelList, parseRequestHeaders, testModelConnection } from './model/client'
import { BrowserRepository } from './workspace/repository'

type InspectorTab = 'preview' | 'problems' | 'diff' | 'source'

const repository = new BrowserRepository()

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceRecord>()
  const [session, setSession] = useState<SessionRecord>()
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [messages, setMessages] = useState<ChatMessageRecord[]>([])
  const [events, setEvents] = useState<AgentEventRecord[]>([])
  const [settings, setSettings] = useState<AgentSettings>()
  const [selectedPath, setSelectedPath] = useState('index.html')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('preview')
  const [previewDiagnostics, setPreviewDiagnostics] = useState<PreviewDiagnostic[]>([])
  const [revisionHistory, setRevisionHistory] = useState<Array<{ revision: number; content: string; createdAt: number }>>([])
  const [inputValue, setInputValue] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | undefined>(undefined)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [streamDraft, setStreamDraft] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const sessionRef = useRef('')
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const workspacePickerRef = useRef<HTMLDivElement>(null)

  const selectedFile = files.find(file => file.path === selectedPath) ?? files[0]
  const artifact = useMemo(() => buildPreview(files, workspace?.entryPath ?? 'index.html'), [files, workspace?.entryPath])
  const diagnostics = [...artifact.diagnostics, ...previewDiagnostics]

  const reload = useCallback(async (workspaceId: string, sessionId: string) => {
    const [nextFiles, nextMessages, nextEvents, nextSessions] = await Promise.all([
      repository.listFiles(workspaceId),
      repository.listMessages(sessionId),
      repository.listEvents(sessionId),
      repository.listSessions(workspaceId),
    ])
    setFiles(nextFiles)
    setMessages(nextMessages)
    setEvents(nextEvents)
    setSessions(nextSessions)
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
    setRevisionHistory([])
    if (workspace && selectedFile) {
      void repository.listRevisions(workspace.id, selectedFile.path).then(setRevisionHistory).catch(() => setRevisionHistory([]))
    }
  }, [selectedFile?.path, selectedFile?.revision, workspace])

  useEffect(() => {
    const scroll = messageScrollRef.current
    if (!scroll) return
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight })
  }, [messages, events, streamDraft, running])

  useEffect(() => {
    if (!workspaceMenuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (!workspacePickerRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWorkspaceMenuOpen(false)
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [workspaceMenuOpen])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (!event.data || typeof event.data !== 'object') return
      const payload = event.data as { source?: unknown; type?: unknown; level?: unknown; message?: unknown; detail?: unknown }
      if (payload.source !== 'chat-web-agent-preview' || payload.type !== 'diagnostic') return
      const level = typeof payload.level === 'string' && (payload.level === 'info' || payload.level === 'warn' || payload.level === 'error') ? payload.level : 'info'
      setPreviewDiagnostics(current => [...current.slice(-19), {
        level,
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
    if (!workspace) return
    if (event.type === 'user_message' || event.type === 'assistant_message' || event.type === 'tool_call' || event.type === 'tool_result') {
      const nextMessages = await repository.listMessages(sessionRef.current || session?.id || '')
      setMessages(nextMessages)
    }
    if (event.type === 'workspace_mutation' || event.type === 'tool_result') {
      const nextFiles = await repository.listFiles(workspace.id)
      setFiles(nextFiles)
    }
  }, [session?.id, workspace])

  const handleSend = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || !workspace || !session || session.archivedAt || !settings || running) return
    setInputValue('')
    setError('')
    setStreamDraft('')
    const optimisticMessage: ChatMessageRecord = {
      id: 'pending_' + Date.now(),
      sessionId: session.id,
      role: 'user',
      content: text,
      createdAt: Date.now(),
      status: 'streaming',
    }
    setMessages(current => [...current, optimisticMessage])
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller
    sessionRef.current = session.id
    try {
      await runUserTurn({
        repository,
        workspaceId: workspace.id,
        sessionId: session.id,
        settings,
        text,
        signal: controller.signal,
        onEvent: handleEvent,
        onDelta: delta => setStreamDraft(current => current + delta),
      })
      setStreamDraft('')
      if (sessionRef.current === session.id) {
        await reload(workspace.id, session.id)
        const nextWorkspace = await repository.getWorkspace(workspace.id)
        if (nextWorkspace) setWorkspace(nextWorkspace)
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause))
      if (sessionRef.current === session.id) await reload(workspace.id, session.id)
    } finally {
      setStreamDraft('')
      abortRef.current = undefined
      setRunning(false)
    }
  }, [handleEvent, inputValue, reload, running, session, settings, workspace])

  const handleNewWorkspace = useCallback(async () => {
    const title = window.prompt('工作区名称', '新建网页工作区')?.trim()
    if (!title) return
    const nextWorkspace = await repository.createWorkspace(title)
    await repository.writeFile(nextWorkspace.id, 'index.html', '<!doctype html><html><head><meta charset="UTF-8"><title>New page</title></head><body><main><h1>New page</h1></main></body></html>')
    const nextSession = await repository.createSession(nextWorkspace.id)
    setWorkspace(nextWorkspace)
    setSession(nextSession)
    sessionRef.current = nextSession.id
    setWorkspaces(await repository.listWorkspaces())
    await reload(nextWorkspace.id, nextSession.id)
  }, [reload])

  const handleNewSession = useCallback(async () => {
    if (!workspace || !settings) return
    const nextSession = await repository.createSession(workspace.id)
    setSession(nextSession)
    sessionRef.current = nextSession.id
    setMessages([])
    setEvents([])
    setStreamDraft('')
    setSessions(await repository.listSessions(workspace.id))
  }, [settings, workspace])

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    if (!workspace) return
    const nextSession = await repository.getSession(sessionId)
    if (!nextSession) return
    setSession(nextSession)
    sessionRef.current = nextSession.id
    setStreamDraft('')
    setRunning(false)
    const [nextMessages, nextEvents] = await Promise.all([
      repository.listMessages(nextSession.id),
      repository.listEvents(nextSession.id),
    ])
    setMessages(nextMessages)
    setEvents(nextEvents)
    setSessions(await repository.listSessions(workspace.id))
  }, [workspace])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (!workspace) return
    if (!window.confirm('确定永久删除这段会话及其消息、工具记录吗？此操作不可撤销。')) return
    try {
      await repository.deleteSession(sessionId)
      const nextSessions = await repository.listSessions(workspace.id)
      let nextSession = session?.id === sessionId ? nextSessions.find(item => !item.archivedAt) : session
      if (!nextSession) nextSession = await repository.createSession(workspace.id)
      setSession(nextSession)
      sessionRef.current = nextSession.id
      await reload(workspace.id, nextSession.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [reload, session, workspace])

  const handleArchiveSession = useCallback(async (sessionId: string, archived: boolean) => {
    if (!workspace) return
    try {
      await repository.setSessionArchived(sessionId, archived)
      const nextSessions = await repository.listSessions(workspace.id)
      if (session?.id === sessionId && archived) {
        const nextSession = nextSessions.find(item => item.id !== sessionId && !item.archivedAt) ?? await repository.createSession(workspace.id)
        setSession(nextSession)
        sessionRef.current = nextSession.id
        await reload(workspace.id, nextSession.id)
      } else {
        const restoredSession = nextSessions.find(item => item.id === sessionId)
        if (session?.id === sessionId && restoredSession) setSession(restoredSession)
        setSessions(nextSessions)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [reload, session?.id, workspace])

  const handleSwitchWorkspace = useCallback(async (workspaceId: string) => {
    const nextWorkspace = await repository.getWorkspace(workspaceId)
    if (!nextWorkspace) return
    const nextSession = await repository.getOrCreateSession(workspaceId)
    setWorkspace(nextWorkspace)
    setSession(nextSession)
    sessionRef.current = nextSession.id
    setSelectedPath(nextWorkspace.entryPath)
    setInspectorCollapsed(false)
    await reload(nextWorkspace.id, nextSession.id)
  }, [reload])

  const handleImportWorkspace = useCallback(async (file: File) => {
    if (!session || !settings) return
    setError('')
    try {
      const imported = await parseWorkspaceZip(file)
      const nextWorkspace = await repository.createWorkspace(imported.title)
      for (const item of imported.files) await repository.writeFile(nextWorkspace.id, item.path, item.content)
      await repository.setEntryPath(nextWorkspace.id, imported.entryPath)
      const nextSession = await repository.createSession(nextWorkspace.id)
      setWorkspace(nextWorkspace)
      setSession(nextSession)
      sessionRef.current = nextSession.id
      setSelectedPath(imported.entryPath)
      setWorkspaces(await repository.listWorkspaces())
      await reload(nextWorkspace.id, nextSession.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [reload, session, settings])

  const handleDeleteWorkspace = useCallback(async (workspaceId: string) => {
    if (!session || !settings) return
    if (!window.confirm('确定删除该工作区及其本地文件、版本记录和会话吗？此操作不可撤销。')) return
    try {
      await repository.deleteWorkspace(workspaceId)
      setWorkspaces(await repository.listWorkspaces())
      if (workspace?.id === workspaceId) {
        const nextWorkspace = await repository.ensureWorkspace()
        const nextSession = await repository.getOrCreateSession(nextWorkspace.id)
        setWorkspace(nextWorkspace)
        setSession(nextSession)
        sessionRef.current = nextSession.id
        setSelectedPath(nextWorkspace.entryPath)
        await reload(nextWorkspace.id, nextSession.id)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [reload, session, settings, workspace?.id])

  const handleSettingsSave = useCallback(async (nextSettings: AgentSettings) => {
    await repository.saveSettings(nextSettings)
    setSettings(nextSettings)
    setSettingsOpen(false)
  }, [])

  if (loading) return <div className="loading-screen"><LoaderCircle className="spin" size={20} /><span>正在加载浏览器工作台</span></div>
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
          <span className="local-badge">本地</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="导出工作区为 ZIP" onClick={() => downloadWorkspaceZip(workspace, files)}><Download size={16} /></button>
          <button className="icon-button" title="打开设置" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /></button>
        </div>
      </header>

      <main className={'workbench' + (sidebarCollapsed ? ' sidebar-collapsed' : '') + (inspectorCollapsed ? ' inspector-collapsed' : '')}>
        {sidebarCollapsed && <button className="sidebar-toggle open" title="展开侧栏" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen size={15} /></button>}
        {inspectorCollapsed && <button className="inspector-toggle open" title="展开沙箱" onClick={() => setInspectorCollapsed(false)}><PanelRightOpen size={15} /></button>}
        <aside className="sidebar">
          <button className="sidebar-toggle" title="折叠侧栏" onClick={() => setSidebarCollapsed(true)}><PanelLeftClose size={15} /></button>
          <div className="sidebar-section workspace-section">
            <div className="section-label"><span>工作区</span><button className="mini-button" title="新建工作区" onClick={() => void handleNewWorkspace()}><Plus size={14} /></button></div>
            <div className="workspace-picker" ref={workspacePickerRef}>
              <button className={'workspace-select' + (workspaceMenuOpen ? ' is-open' : '')} aria-haspopup="listbox" aria-expanded={workspaceMenuOpen} onClick={() => setWorkspaceMenuOpen(current => !current)}>
                <Sparkles size={14} />
                <span className="workspace-select-text">{workspace.title}</span>
                <ChevronDown size={14} />
              </button>
              {workspaceMenuOpen && <div className="workspace-menu" role="listbox">
                {workspaces.map(item => <button className={'workspace-option' + (item.id === workspace.id ? ' is-selected' : '')} role="option" aria-selected={item.id === workspace.id} key={item.id} onClick={() => { setWorkspaceMenuOpen(false); void handleSwitchWorkspace(item.id) }}><span>{item.title}</span>{item.id === workspace.id && <CheckCircle2 size={14} />}</button>)}
              </div>}
            </div>
            <div className="workspace-meta"><span>{files.length} 个文件</span><span>IndexedDB</span></div>
          </div>
          <div className="sidebar-section file-section">
            <div className="section-label"><span>文件</span><span className="muted-count">{files.length}</span></div>
            <div className="file-list">
              {files.map(file => (
                <button className={'file-row' + (selectedFile?.path === file.path ? ' is-selected' : '')} key={file.path} onClick={() => setSelectedPath(file.path)}>
                  {file.kind === 'html' ? <Code2 size={15} /> : file.kind === 'css' ? <FileCode2 size={15} /> : file.kind === 'javascript' ? <Play size={14} /> : <FileText size={15} />}
                  <span className="file-name">{file.path}</span>
                  <span className="file-revision">r{file.revision}</span>
                </button>
              ))}
            </div>
            <div className="sidebar-note"><span className="note-line" /><span>Agent 只能访问虚拟工作台中的网页文件。</span></div>
          </div>
          <div className="sidebar-section session-section">
            <div className="section-label"><span>会话</span><button className="mini-button" title="新建会话" onClick={() => void handleNewSession()}><Plus size={14} /></button></div>
            <SessionList sessions={sessions.filter(item => !item.archivedAt)} activeSessionId={session.id} onSelect={handleSwitchSession} onArchive={id => void handleArchiveSession(id, true)} onDelete={handleDeleteSession} />
            {sessions.some(item => item.archivedAt) && <>
              <div className="section-label archived-label"><span>已归档</span></div>
              <SessionList sessions={sessions.filter(item => item.archivedAt)} activeSessionId={session.id} onSelect={handleSwitchSession} onArchive={id => void handleArchiveSession(id, false)} onDelete={handleDeleteSession} archived />
            </>}
          </div>
          <div className="sidebar-footer">
            <button className="sidebar-action" onClick={() => void handleNewWorkspace()}><FolderPlus size={15} /><span>新建工作区</span></button>
            <label className="sidebar-action" title="导入工作区 ZIP"><FolderUp size={15} /><span>导入工作区</span><input className="hidden-file-input" type="file" accept=".zip,application/zip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void handleImportWorkspace(file) }} /></label>
            <button className="sidebar-action" onClick={() => void handleDeleteWorkspace(workspace.id)}><Trash2 size={15} /><span>删除工作区</span></button>
            <button className="sidebar-action" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /><span>设置</span></button>
          </div>
        </aside>

        <section className="conversation-panel">
          <div className="panel-heading conversation-heading">
            <div><span className="eyebrow">会话</span><h1>{session.title}</h1></div>
            <div className="heading-actions"><button className="icon-button" title="新建会话" onClick={() => void handleNewSession()}><Plus size={15} /></button><div className="model-chip"><span className={settings.demoMode ? 'mode-dot demo' : 'mode-dot'} />{settings.demoMode ? '演示模型' : settings.model}</div></div>
          </div>
          <div className="message-scroll" ref={messageScrollRef}>
            {messages.length === 0 && <EmptyConversation onPrompt={setInputValue} />}
            {messages.map(message => <MessageView key={message.id} message={message} events={events} segmented={settings.segmentResponses} />)}
            <ReviewNotice events={events} />
            {streamDraft && <div className="assistant-block streaming-draft"><div className="assistant-avatar"><Bot size={15} /></div><div className="assistant-copy"><span className="stream-text">{streamDraft}</span><span className="stream-caret" /></div></div>}
            {running && messages.length === 0 && !streamDraft && <div className="thinking-row"><LoaderCircle size={15} className="spin" /><span>正在虚拟工作台中工作</span></div>}
            {error && <div className="inline-error"><AlertTriangle size={15} /><span>{error}</span><button className="icon-button tiny" title="关闭错误提示" onClick={() => setError('')}><X size={14} /></button></div>}
          </div>
          <form className="composer" onSubmit={event => { event.preventDefault(); void handleSend() }}>
            <div className="composer-shell">
              <textarea value={inputValue} onChange={event => setInputValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (inputValue.trim() && !running) void handleSend() } }} placeholder={session.archivedAt ? '该会话已归档，恢复后可以继续对话' : '让 Agent 修改页面，或检查虚拟工作台...（Enter 发送，Shift+Enter 换行）'} rows={2} disabled={running || !!session.archivedAt} />
              <div className="composer-tools">
                <span className="composer-hint"><Wrench size={13} /> 工具只在本工作台内运行</span>
                {running
                  ? <button type="button" className="send-button stop" title="停止当前回合" onClick={() => abortRef.current?.abort()}><Square size={15} fill="currentColor" /></button>
                  : <button type="submit" className="send-button" title="发送消息" disabled={!inputValue.trim() || !!session.archivedAt}><Send size={16} /></button>}
              </div>
            </div>
          </form>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs" role="tablist">
            <button className={inspectorTab === 'preview' ? 'active' : ''} onClick={() => setInspectorTab('preview')}><Eye size={15} />预览</button>
            <button className={inspectorTab === 'source' ? 'active' : ''} onClick={() => setInspectorTab('source')}><Code2 size={15} />源码</button>
            <button className={inspectorTab === 'problems' ? 'active' : ''} onClick={() => setInspectorTab('problems')}><AlertTriangle size={15} />问题{diagnostics.length > 0 && <span className="tab-count">{diagnostics.length}</span>}</button>
            <button className={inspectorTab === 'diff' ? 'active' : ''} onClick={() => setInspectorTab('diff')}><GitCompare size={15} />差异</button>
            <button className="inspector-collapse-button" title={inspectorCollapsed ? '展开检查器' : '折叠检查器'} onClick={() => setInspectorCollapsed(current => !current)}>{inspectorCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}</button>
          </div>
          {inspectorCollapsed
            ? null
            : <>{inspectorTab === 'preview' && <PreviewPanel artifact={artifact} iframeRef={iframeRef} previewKey={previewKey} onRefresh={() => setPreviewDiagnostics([])} onReset={() => setPreviewKey(current => current + 1)} onDownload={() => { const entry = files.find(file => file.path === (workspace.entryPath || 'index.html')) ?? files.find(file => file.kind === 'html'); if (entry) downloadFile(entry) }} />}
            {inspectorTab === 'source' && <SourcePanel file={selectedFile} />}
            {inspectorTab === 'problems' && <ProblemsPanel diagnostics={diagnostics} />}
            {inspectorTab === 'diff' && <DiffPanel file={selectedFile} revisions={revisionHistory} />}</>}
        </aside>
      </main>

      {settingsOpen && <SettingsModal value={settings} onClose={() => setSettingsOpen(false)} onSave={next => void handleSettingsSave(next)} />}
    </div>
  )
}

function SessionList({ sessions, activeSessionId, onSelect, onArchive, onDelete, archived = false }: {
  sessions: SessionRecord[]
  activeSessionId: string
  onSelect: (sessionId: string) => void
  onArchive: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  archived?: boolean
}) {
  if (sessions.length === 0) return <div className="session-empty">暂无会话</div>
  return (
    <div className="session-list">
      {sessions.map(item => (
        <div className={'session-row' + (activeSessionId === item.id ? ' is-selected' : '')} key={item.id}>
          <button className="session-open" onClick={() => onSelect(item.id)}>
            <MessageCircle size={14} />
            <span className="session-name">{item.title}</span>
          </button>
          <span className="session-actions">
            <button className="session-action" title={archived ? '恢复会话' : '归档会话'} onClick={() => onArchive(item.id)}>{archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}</button>
            <button className="session-action danger" title="永久删除会话" onClick={() => onDelete(item.id)}><Trash2 size={13} /></button>
          </span>
        </div>
      ))}
    </div>
  )
}

function EmptyConversation({ onPrompt }: { onPrompt: (value: string) => void }) {
  const prompts = ['做一个有悬浮交互的首页', '搜索一下浏览器 Agent 的最新资料', '读取当前文件并告诉我哪里可以改进']
  return (
    <div className="empty-conversation">
      <div className="empty-orbit"><Bot size={28} /></div>
      <h2>我们做点什么？</h2>
      <p>从一个小的网页创意开始。Agent 可以读取、写入、搜索并解释虚拟工作台中的文件。</p>
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

function ReviewNotice({ events }: { events: AgentEventRecord[] }) {
  const review = events.find(item => item.type === 'review_result')
  if (!review) return null
  const verdict = review.payload as { pass?: boolean; issues?: string[]; repairInstruction?: string; reviewed?: boolean }
  if (verdict.pass !== false) return null
  return (
    <div className="review-notice">
      <AlertTriangle size={14} />
      <div>
        <strong>发布检查发现以下问题</strong>
        <span>{verdict.issues?.join('；') || '未指明的问题。'}{verdict.repairInstruction ? ' —— ' + verdict.repairInstruction : ''}</span>
      </div>
    </div>
  )
}

function PreviewPanel({ artifact, iframeRef, onRefresh, onReset, onDownload, previewKey }: {
  artifact: ReturnType<typeof buildPreview>
  iframeRef: RefObject<HTMLIFrameElement | null>
  onRefresh: () => void
  onReset: () => void
  onDownload: () => void
  previewKey: number
}) {
  return (
    <div className="inspector-content preview-content">
      <div className="inspector-toolbar"><span className="toolbar-title"><span className="preview-pulse" />实时预览</span><span className="preview-actions"><button className="icon-button tiny" title="从工作台文件重新构建预览" onClick={onRefresh}><RefreshCw size={14} /></button><button className="icon-button tiny" title="重置沙箱 iframe" onClick={onReset}><Trash2 size={14} /></button><button className="icon-button tiny" title="下载入口 HTML" onClick={onDownload}><Download size={14} /></button></span></div>
      <div className="preview-frame-wrap"><iframe key={previewKey} ref={iframeRef} title="沙箱项目预览" sandbox="allow-scripts" srcDoc={artifact.srcdoc} /></div>
    </div>
  )
}

function SourcePanel({ file }: { file?: WorkspaceFile }) {
  return (
    <div className="inspector-content source-content">
      <div className="source-heading"><span className="toolbar-title"><Code2 size={13} />源码</span>{file && <span className="source-path">{file.path} · r{file.revision}</span>}</div>
      {file
        ? <pre className="source-view"><code>{file.content}</code></pre>
        : <div className="empty-inspector"><FileText size={22} /><strong>请选择一个文件</strong><span>源码与左侧工作台文件保持实时同步。</span></div>}
    </div>
  )
}

function ProblemsPanel({ diagnostics }: { diagnostics: PreviewDiagnostic[] }) {  return <div className="inspector-content problems-content">{diagnostics.length === 0 ? <div className="empty-inspector"><CheckCircle2 size={22} /><strong>未检测到问题</strong><span>最近一次预览构建没有报错。</span></div> : diagnostics.map((item, index) => <div className={'problem-item ' + item.level} key={item.message + index}>{item.level === 'error' ? <AlertTriangle size={15} /> : <CircleIcon level={item.level} />}<div><strong>{item.message}</strong>{item.detail && <pre>{item.detail}</pre>}</div></div>)}</div>
}

function CircleIcon({ level }: { level: 'info' | 'warn' }) {
  return level === 'warn' ? <AlertTriangle size={15} /> : <span className="info-icon">i</span>
}

function DiffPanel({ file, revisions }: { file?: WorkspaceFile; revisions: Array<{ revision: number; content: string; createdAt: number }> }) {
  if (!file) return <div className="inspector-content empty-inspector"><FileText size={22} /><strong>请选择一个文件</strong></div>
  const previous = revisions.find(item => item.revision === file.revision - 1)
  const lines = previous ? buildLineDiff(previous.content, file.content) : []
  return <div className="inspector-content diff-content"><div className="diff-heading"><span>{file.path}</span><span>r{file.revision}</span></div>{previous ? <pre className="diff-view">{lines.map((line, index) => <span className={'diff-line ' + line.type} key={index}><b>{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</b>{line.value || ' '}{'\n'}</span>)}</pre> : <div className="empty-inspector compact"><GitCompare size={20} /><span>该文件没有更早的版本。</span></div>}</div>
}

function SettingsModal({ value, onClose, onSave }: { value: AgentSettings; onClose: () => void; onSave: (value: AgentSettings) => void }) {
  const [draft, setDraft] = useState(value)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'done'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [testOk, setTestOk] = useState(false)
  const [listState, setListState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [listMessage, setListMessage] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [headerError, setHeaderError] = useState('')
  const patch = (next: Partial<AgentSettings>) => setDraft(current => ({ ...current, ...next }))
  const handleTest = async () => {
    setTestState('testing')
    setTestMessage('')
    setTestOk(false)
    try {
      const result = await testModelConnection(draft)
      setTestMessage(result.message)
      setTestOk(result.ok)
    } catch (cause) {
      setTestMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTestState('done')
    }
  }
  const handleFetchModels = async () => {
    setListState('loading')
    setListMessage('')
    setModels([])
    try {
      const fetched = await fetchModelList(draft)
      if (fetched.length === 0) {
        setListMessage('接口已响应，但未返回任何模型。')
      } else {
        setModels(fetched)
        if (!fetched.includes(draft.model)) patch({ model: fetched[0] })
        setListMessage(`找到 ${fetched.length} 个模型。`)
      }
    } catch (cause) {
      setListMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setListState('done')
    }
  }
  return (
    <div className="modal-layer" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="settings-modal">
        <div className="modal-heading"><div><span className="eyebrow">运行时</span><h2>Agent 设置</h2></div><button className="icon-button" title="关闭设置" onClick={onClose}><X size={17} /></button></div>
        <div className="settings-scroll">
          <label className="setting-toggle"><input type="checkbox" checked={draft.demoMode} onChange={event => patch({ demoMode: event.target.checked })} /><span><strong>演示模式</strong><small>使用内置的确定性流程，不发起网络请求。开启后下面的拉取与测试按钮不可用。</small></span></label>
          <label className="field-label">模型 API 地址<input value={draft.apiBaseUrl} onChange={event => patch({ apiBaseUrl: event.target.value })} placeholder="https://api.deepseek.com/v1" /></label>
          <label className="field-label">API Key<input type="password" value={draft.apiKey} onChange={event => patch({ apiKey: event.target.value })} placeholder="仅保存在本浏览器内" /></label>
          <label className="field-label">自定义请求头<small className="field-hint">JSON 对象，会合并到每个模型请求中，用于中转站要求特定请求头的场景（例如 &#123;"User-Agent": "codex-router/1.0.0"&#125;）。浏览器禁止的请求头会被忽略。</small><textarea value={draft.customHeaders} onChange={event => patch({ customHeaders: event.target.value })} rows={3} placeholder='{"User-Agent": "codex-router/1.0.0"}' /></label>
          {headerError && <div className="header-error">{headerError}</div>}
          <label className="field-label">模型<div className="model-row"><input value={draft.model} onChange={event => patch({ model: event.target.value })} placeholder="deepseek-chat" list="model-options" /><button className="secondary-button" disabled={listState === 'loading' || draft.demoMode} title={draft.demoMode ? '请先关闭演示模式' : '从 /models 接口拉取模型列表'} onClick={() => void handleFetchModels()}>{listState === 'loading' ? <LoaderCircle size={13} className="spin" /> : <ListTree size={13} />}拉取模型</button></div>{models.length > 0 && <select className="model-picker" value={draft.model} onChange={event => patch({ model: event.target.value })}>{models.map(item => <option key={item} value={item}>{item}</option>)}</select>}<datalist id="model-options">{models.map(item => <option key={item} value={item} />)}</datalist>{listMessage && <span className="test-message">{listMessage}</span>}</label>
          <div className="test-row">
            <button className="secondary-button" disabled={testState === 'testing' || draft.demoMode} title={draft.demoMode ? '请先关闭演示模式' : '测试接口连通性'} onClick={() => void handleTest()}>{testState === 'testing' ? <LoaderCircle size={13} className="spin" /> : <PlugZap size={13} />}测试连接</button>
            {testMessage && <span className={'test-message' + (testState === 'done' && testOk ? ' ok' : '')}>{testMessage}</span>}
          </div>
          <div className="settings-divider" />
          <label className="field-label">搜索服务<select value={draft.searchProvider} onChange={event => patch({ searchProvider: event.target.value as AgentSettings['searchProvider'] })}><option value="disabled">已禁用</option><option value="duckduckgo">DuckDuckGo JSON</option><option value="custom">自定义 CORS 接口</option></select></label>
          {draft.searchProvider === 'custom' && <><label className="field-label">搜索接口地址<input value={draft.searchEndpoint} onChange={event => patch({ searchEndpoint: event.target.value })} placeholder="https://example.com/search" /></label><label className="field-label">搜索请求头<small className="field-hint">JSON 对象，可附带请求头。</small><textarea value={draft.searchHeaders} onChange={event => patch({ searchHeaders: event.target.value })} rows={3} placeholder="{}" /></label></>}
          <label className="setting-toggle"><input type="checkbox" checked={draft.segmentResponses} onChange={event => patch({ segmentResponses: event.target.checked })} /><span><strong>分句节奏</strong><small>将最终回答拆成短句逐步展示。</small></span></label>
          <label className="setting-toggle"><input type="checkbox" checked={draft.reviewResponses} onChange={event => patch({ reviewResponses: event.target.checked })} /><span><strong>发布检查</strong><small>回答进入聊天前用模型复查；未通过的会触发一轮修复。</small></span></label>
          <div className="number-row"><label className="field-label">最大步数<input type="number" min={1} max={20} value={draft.maxSteps} onChange={event => patch({ maxSteps: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label><label className="field-label">最大工具调用<input type="number" min={1} max={50} value={draft.maxToolCalls} onChange={event => patch({ maxToolCalls: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} /></label></div>
          <div className="number-row"><label className="field-label">修复轮数<input type="number" min={0} max={3} value={draft.maxRepairRounds} onChange={event => patch({ maxRepairRounds: Math.max(0, Math.min(3, Number(event.target.value) || 0)) })} /></label></div>
        </div>
        <div className="modal-actions"><span className="security-note">API Key 永远不会进入预览页面或导出的 ZIP。</span><button className="primary-button" onClick={() => { try { parseRequestHeaders(draft.customHeaders); onSave(draft) } catch (cause) { setHeaderError(cause instanceof Error ? cause.message : String(cause)) } }}>保存设置</button></div>
      </section>
    </div>
  )
}
