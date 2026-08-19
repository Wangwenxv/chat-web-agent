import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { AlertTriangle, Bot, Code2, Download, Eye, GitCompare, LoaderCircle, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Settings2, X } from 'lucide-react'
import type { AgentEventRecord, AgentSettings, ChatMessageRecord, PreviewDiagnostic, SessionRecord, WorkspaceFile, WorkspaceRecord } from './types'
import { buildPreview } from './preview/build'
import { downloadFile, downloadWorkspaceZip, parseWorkspaceZip } from './export/zip'
import { runUserTurn } from './agent/runner'
import { BrowserRepository } from './workspace/repository'
import { Sidebar } from './components/workspace/Sidebar'
import { SessionList } from './components/chat/SessionList'
import { MessageView, EmptyConversation, TurnStatus } from './components/chat/MessageView'
import { Composer } from './components/chat/Composer'
import { PreviewPanel } from './components/inspector/PreviewPanel'
import { SourcePanel, ProblemsPanel, DiffPanel } from './components/inspector/InspectorPanels'
import { SettingsModal } from './components/settings/SettingsModal'

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
  const [narrowLayout, setNarrowLayout] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(() => Math.max(360, Math.round(window.innerWidth * .39)))
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const sessionRef = useRef('')
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const workspacePickerRef = useRef<HTMLDivElement>(null)
  const inspectorResizeRef = useRef<{ startX: number; startWidth: number } | undefined>(undefined)

  const selectedFile = files.find(file => file.path === selectedPath) ?? files[0]
  const artifact = useMemo(() => buildPreview(files, workspace?.entryPath ?? 'index.html'), [files, workspace?.entryPath])
  const diagnostics = [...artifact.diagnostics, ...previewDiagnostics]

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1180px)')
    const syncLayout = () => {
      const isNarrow = media.matches
      setNarrowLayout(isNarrow)
      if (isNarrow) {
        setSidebarCollapsed(true)
        setInspectorCollapsed(true)
      }
    }
    syncLayout()
    media.addEventListener('change', syncLayout)
    return () => media.removeEventListener('change', syncLayout)
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = inspectorResizeRef.current
      if (!drag || narrowLayout) return
      const maxWidth = Math.min(760, Math.max(360, window.innerWidth - 520))
      const nextWidth = Math.max(320, Math.min(maxWidth, drag.startWidth + drag.startX - event.clientX))
      setInspectorWidth(nextWidth)
    }
    const stopResize = () => { inspectorResizeRef.current = undefined; document.body.classList.remove('is-resizing-inspector') }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }
  }, [narrowLayout])

  const startInspectorResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (narrowLayout) return
    event.preventDefault()
    inspectorResizeRef.current = { startX: event.clientX, startWidth: inspectorWidth }
    document.body.classList.add('is-resizing-inspector')
  }, [inspectorWidth, narrowLayout])

  const openSidebar = useCallback(() => {
    if (narrowLayout) setInspectorCollapsed(true)
    setSidebarCollapsed(false)
  }, [narrowLayout])

  const openInspector = useCallback(() => {
    if (narrowLayout) setSidebarCollapsed(true)
    setInspectorCollapsed(false)
  }, [narrowLayout])

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
    if (event.type === 'assistant_message' || event.type === 'tool_call' || event.type === 'turn_end') {
      setStreamDraft('')
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
    if (narrowLayout) {
      setSidebarCollapsed(true)
      setInspectorCollapsed(true)
    } else {
      setInspectorCollapsed(false)
    }
    await reload(nextWorkspace.id, nextSession.id)
  }, [narrowLayout, reload])

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

  const handleSourceSave = useCallback(async (file: WorkspaceFile, content: string) => {
    if (!workspace) throw new Error('工作区已关闭')
    await repository.writeFile(workspace.id, file.path, content, file.revision)
    const nextFiles = await repository.listFiles(workspace.id)
    setFiles(nextFiles)
  }, [workspace])

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

      <main className={'workbench' + (sidebarCollapsed ? ' sidebar-collapsed' : ' sidebar-open') + (inspectorCollapsed ? ' inspector-collapsed' : ' inspector-open') + (narrowLayout ? ' narrow-layout' : '')} style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties}>
        {sidebarCollapsed && <button className="sidebar-toggle open" title="展开侧栏" onClick={openSidebar}><PanelLeftOpen size={15} /></button>}
        {inspectorCollapsed && <button className="inspector-toggle open" title="展开检查器" onClick={openInspector}><PanelRightOpen size={15} /></button>}
        {narrowLayout && (!sidebarCollapsed || !inspectorCollapsed) && <button className="mobile-backdrop" aria-label="关闭侧栏" onClick={() => { setSidebarCollapsed(true); setInspectorCollapsed(true) }} />}

        <Sidebar
          workspace={workspace}
          workspaces={workspaces}
          fileCount={files.length}
          workspaceMenuOpen={workspaceMenuOpen}
          pickerRef={workspacePickerRef}
          sessionSections={
            <>
              <SessionList sessions={sessions.filter(item => !item.archivedAt)} activeSessionId={session.id} onSelect={handleSwitchSession} onArchive={id => void handleArchiveSession(id, true)} onDelete={handleDeleteSession} />
              {sessions.some(item => item.archivedAt) && <>
                <div className="section-label archived-label"><span>已归档</span></div>
                <SessionList sessions={sessions.filter(item => item.archivedAt)} activeSessionId={session.id} onSelect={handleSwitchSession} onArchive={id => void handleArchiveSession(id, false)} onDelete={handleDeleteSession} archived />
              </>}
            </>
          }
          onToggleWorkspaceMenu={() => setWorkspaceMenuOpen(current => !current)}
          onSelectWorkspace={id => void handleSwitchWorkspace(id)}
          onNewWorkspace={() => void handleNewWorkspace()}
          onImportWorkspace={file => void handleImportWorkspace(file)}
          onDeleteWorkspace={() => void handleDeleteWorkspace(workspace.id)}
          onNewSession={() => void handleNewSession()}
          onOpenSettings={() => setSettingsOpen(true)}
          onCollapse={() => setSidebarCollapsed(true)}
          mobileOpen={narrowLayout ? !sidebarCollapsed : undefined}
        />

        <section className="conversation-panel">
          <div className="panel-heading conversation-heading">
            <div><span className="eyebrow">会话</span><h1>{session.title}</h1></div>
            <div className="heading-actions">
              <button className="icon-button" title="新建会话" onClick={() => void handleNewSession()}><Plus size={15} /></button>
              <div className="model-chip"><span className="mode-dot" />{settings.model}</div>
            </div>
          </div>
          <div className="message-scroll" ref={messageScrollRef}>
            {messages.length === 0 && !running && <EmptyConversation onPrompt={setInputValue} />}
            {messages.map(message => <MessageView key={message.id} message={message} events={events} />)}
            {running && <TurnStatus />}
            {streamDraft && <div className="assistant-block streaming-draft"><div className="assistant-copy"><span className="stream-text">{streamDraft}</span><span className="stream-caret" /></div></div>}
            {error && <div className="inline-error"><AlertTriangle size={15} /><span>{error}</span><button className="icon-button tiny" title="关闭错误提示" onClick={() => setError('')}><X size={14} /></button></div>}
          </div>
          <Composer
            value={inputValue}
            running={running}
            disabled={running || !!session.archivedAt}
            placeholder={session.archivedAt ? '该会话已归档，恢复后可以继续对话' : '让 Agent 修改页面，或检查虚拟工作台...（Enter 发送，Shift+Enter 换行）'}
            onChange={setInputValue}
            onSend={() => void handleSend()}
            onStop={() => abortRef.current?.abort()}
          />
        </section>

        <aside className="inspector-panel" style={narrowLayout ? {
          display: 'grid',
          pointerEvents: inspectorCollapsed ? 'none' : 'auto',
          transform: inspectorCollapsed ? 'translateX(105%)' : 'translateX(0)',
          zIndex: 100,
        } : undefined}>
          <div className="inspector-resize-handle" role="separator" aria-label="调整检查器宽度" onPointerDown={startInspectorResize} />
          <div className="inspector-sidebar-heading">
            <span className="section-label">检查器</span>
            <button className="inspector-sidebar-collapse" title="折叠检查器" onClick={() => setInspectorCollapsed(true)}><PanelRightClose size={15} /></button>
          </div>
          <div className="inspector-tabs" role="tablist">
            <button className={inspectorTab === 'preview' ? 'active' : ''} onClick={() => setInspectorTab('preview')}><Eye size={15} />预览</button>
            <button className={inspectorTab === 'source' ? 'active' : ''} onClick={() => setInspectorTab('source')}><Code2 size={15} />源码</button>
            <button className={inspectorTab === 'problems' ? 'active' : ''} onClick={() => setInspectorTab('problems')}><AlertTriangle size={15} />问题{diagnostics.length > 0 && <span className="tab-count">{diagnostics.length}</span>}</button>
            <button className={inspectorTab === 'diff' ? 'active' : ''} onClick={() => setInspectorTab('diff')}><GitCompare size={15} />差异</button>
          </div>
          {!inspectorCollapsed && (
            <>
              {inspectorTab === 'preview' && <PreviewPanel artifact={artifact} iframeRef={iframeRef} previewKey={previewKey} onRefresh={() => setPreviewDiagnostics([])} onReset={() => setPreviewKey(current => current + 1)} onDownload={() => { const entry = files.find(file => file.path === (workspace.entryPath || 'index.html')) ?? files.find(file => file.kind === 'html'); if (entry) downloadFile(entry) }} />}
              {inspectorTab === 'source' && <SourcePanel file={selectedFile} files={files} onSelectFile={setSelectedPath} onSave={handleSourceSave} />}
              {inspectorTab === 'problems' && <ProblemsPanel diagnostics={diagnostics} />}
              {inspectorTab === 'diff' && <DiffPanel file={selectedFile} revisions={revisionHistory} />}
            </>
          )}
        </aside>
      </main>

      {settingsOpen && <SettingsModal value={settings} onClose={() => setSettingsOpen(false)} onSave={next => void handleSettingsSave(next)} />}
    </div>
  )
}
