import type {
  AgentEventRecord,
  AgentSettings,
  ChatMessageRecord,
  PreviewPermissions,
  SessionRecord,
  WorkspaceFile,
  WorkspaceRecord,
} from '../types'
import { DEFAULT_PREVIEW_PERMISSIONS } from '../types'
import { fileMetaFromPath, normalizeWorkspacePath } from '../lib/path'

const DB_NAME = 'chat-web-agent'
const DB_VERSION = 1
const DEFAULT_SETTINGS: AgentSettings = {
  apiBaseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  customHeaders: '',
  supportsMultimodal: false,
}

export class RevisionConflictError extends Error {
  constructor(
    public readonly path: string,
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`Revision conflict for ${path}: expected ${expected}, current ${actual}`)
    this.name = 'RevisionConflictError'
  }
}

export class WorkspacePolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspacePolicyError'
  }
}

export interface GrepQuery {
  pattern: string
  useRegex: boolean
  caseSensitive: boolean
  maxResults: number
  pathFilter: string
}

export interface GrepResult {
  matches: { path: string; line: number; text: string }[]
  truncated: boolean
  error?: string
  elapsedMs: number
}

export interface WorkspaceStats {
  files: number
  totalBytes: number
  fileLimit: number
  byteLimit: number
}

let grepWorker: Worker | null = null
let grepToken = 0
const grepWaiters: { resolve: (value: GrepResult) => void }[] = []

function getGrepWorker(): Worker {
  if (grepWorker) return grepWorker
  grepWorker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' })
  grepWorker.onmessage = (
    event: MessageEvent<{ type: 'result'; result?: GrepResult; error?: string }>,
  ) => {
    const waiter = grepWaiters.shift()
    if (!waiter) return
    const { result, error } = event.data
    waiter.resolve(
      error
        ? { matches: [], truncated: false, error, elapsedMs: 0 }
        : (result ?? { matches: [], truncated: false, elapsedMs: 0 }),
    )
  }
  return grepWorker
}

function createId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}_${uuid}`
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      const workspaces = db.createObjectStore('workspaces', { keyPath: 'id' })
      workspaces.createIndex('updatedAt', 'updatedAt')

      const files = db.createObjectStore('files', { keyPath: 'id' })
      files.createIndex('workspaceId', 'workspaceId')
      files.createIndex('workspacePath', ['workspaceId', 'path'], { unique: true })

      const revisions = db.createObjectStore('revisions', { keyPath: 'id' })
      revisions.createIndex('fileId', 'fileId')
      revisions.createIndex('workspaceId', 'workspaceId')

      const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
      sessions.createIndex('workspaceId', 'workspaceId')
      sessions.createIndex('updatedAt', 'updatedAt')

      const messages = db.createObjectStore('messages', { keyPath: 'id' })
      messages.createIndex('sessionId', 'sessionId')
      messages.createIndex('createdAt', 'createdAt')

      const events = db.createObjectStore('events', { keyPath: 'id' })
      events.createIndex('sessionId', 'sessionId')
      events.createIndex('createdAt', 'createdAt')

      db.createObjectStore('settings', { keyPath: 'id' })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('Unable to open IndexedDB'))
  })
}

export class BrowserRepository {
  private readonly db = openDatabase()

  async getSettings(): Promise<AgentSettings> {
    const db = await this.db
    const tx = db.transaction('settings', 'readonly')
    const done = transactionDone(tx)
    const stored = (await request(tx.objectStore('settings').get('default'))) as
      AgentSettings | undefined
    await done
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  }

  async saveSettings(settings: AgentSettings): Promise<void> {
    const db = await this.db
    const tx = db.transaction('settings', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('settings').put({ id: 'default', ...settings })
    await done
  }

  async getPreviewPermissions(): Promise<PreviewPermissions> {
    const db = await this.db
    const tx = db.transaction('settings', 'readonly')
    const done = transactionDone(tx)
    const stored = (await request(tx.objectStore('settings').get('preview-permissions'))) as
      PreviewPermissions | undefined
    await done
    return { ...DEFAULT_PREVIEW_PERMISSIONS, ...(stored ?? {}) }
  }

  async savePreviewPermissions(permissions: PreviewPermissions): Promise<void> {
    const db = await this.db
    const tx = db.transaction('settings', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('settings').put({ id: 'preview-permissions', ...permissions })
    await done
  }

  async getPreviewStorage(workspaceId: string): Promise<Record<string, string>> {
    const db = await this.db
    const tx = db.transaction('settings', 'readonly')
    const done = transactionDone(tx)
    const stored = (await request(
      tx.objectStore('settings').get('preview-storage:' + workspaceId),
    )) as Record<string, string> | undefined
    await done
    return stored ?? {}
  }

  async savePreviewStorage(workspaceId: string, data: Record<string, string>): Promise<void> {
    const db = await this.db
    const tx = db.transaction('settings', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('settings').put({ id: 'preview-storage:' + workspaceId, ...data })
    await done
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const db = await this.db
    const tx = db.transaction('workspaces', 'readonly')
    const done = transactionDone(tx)
    const values = await request(tx.objectStore('workspaces').getAll())
    await done
    return (values as WorkspaceRecord[]).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    const db = await this.db
    const tx = db.transaction('workspaces', 'readonly')
    const done = transactionDone(tx)
    const value = (await request(tx.objectStore('workspaces').get(id))) as
      WorkspaceRecord | undefined
    await done
    return value
  }

  async ensureWorkspace(): Promise<WorkspaceRecord> {
    const existing = (await this.listWorkspaces())[0]
    if (existing) return existing
    const workspace = await this.createWorkspace('Web Agent workspace')
    await this.writeFile(workspace.id, 'index.html', seedFiles['index.html'])
    await this.writeFile(workspace.id, 'styles.css', seedFiles['styles.css'])
    await this.writeFile(workspace.id, 'main.js', seedFiles['main.js'])
    return (await this.getWorkspace(workspace.id)) ?? workspace
  }

  async createWorkspace(title: string): Promise<WorkspaceRecord> {
    const now = Date.now()
    const workspace: WorkspaceRecord = {
      id: createId('ws'),
      title: title.trim() || 'Untitled workspace',
      createdAt: now,
      updatedAt: now,
      entryPath: 'index.html',
    }
    const db = await this.db
    const tx = db.transaction('workspaces', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('workspaces').put(workspace)
    await done
    return workspace
  }

  async touchWorkspace(workspaceId: string): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId)
    if (!workspace) return
    const db = await this.db
    const tx = db.transaction('workspaces', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('workspaces').put({ ...workspace, updatedAt: Date.now() })
    await done
  }

  async setEntryPath(workspaceId: string, path: string): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId)
    if (!workspace) return
    const normalized = requirePath(path)
    const db = await this.db
    const tx = db.transaction('workspaces', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('workspaces').put({ ...workspace, entryPath: normalized, updatedAt: Date.now() })
    await done
  }

  async createSession(workspaceId: string, title = '新会话'): Promise<SessionRecord> {
    const now = Date.now()
    const session: SessionRecord = {
      id: createId('session'),
      workspaceId,
      title,
      createdAt: now,
      updatedAt: now,
      modelId: (await this.getSettings()).model,
    }
    const db = await this.db
    const tx = db.transaction('sessions', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('sessions').put(session)
    await done
    return session
  }

  async getOrCreateSession(workspaceId: string): Promise<SessionRecord> {
    const sessions = await this.listSessions(workspaceId)
    return sessions.find((session) => !session.archivedAt) ?? this.createSession(workspaceId)
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const db = await this.db
    const tx = db.transaction('sessions', 'readonly')
    const done = transactionDone(tx)
    const value = (await request(tx.objectStore('sessions').get(id))) as SessionRecord | undefined
    await done
    return value
  }

  async listSessions(workspaceId: string): Promise<SessionRecord[]> {
    const db = await this.db
    const tx = db.transaction('sessions', 'readonly')
    const done = transactionDone(tx)
    const values = await request(
      tx.objectStore('sessions').index('workspaceId').getAll(workspaceId),
    )
    await done
    return (values as SessionRecord[]).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async listFiles(workspaceId: string): Promise<WorkspaceFile[]> {
    const db = await this.db
    const tx = db.transaction('files', 'readonly')
    const done = transactionDone(tx)
    const values = await request(tx.objectStore('files').index('workspaceId').getAll(workspaceId))
    await done
    return (values as (WorkspaceFile & { id: string; workspaceId: string })[]).sort((a, b) =>
      a.path.localeCompare(b.path),
    )
  }

  async getFile(workspaceId: string, path: string): Promise<WorkspaceFile | undefined> {
    const normalized = requirePath(path)
    const db = await this.db
    const tx = db.transaction('files', 'readonly')
    const done = transactionDone(tx)
    const value = (await request(
      tx.objectStore('files').index('workspacePath').get([workspaceId, normalized]),
    )) as (WorkspaceFile & { id: string; workspaceId: string }) | undefined
    await done
    return value
  }

  async writeFile(
    workspaceId: string,
    path: string,
    content: string,
    expectedRevision?: number,
  ): Promise<WorkspaceFile> {
    const normalized = requirePath(path)
    const current = await this.getFile(workspaceId, normalized)
    if (current && expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new RevisionConflictError(normalized, expectedRevision, current.revision)
    }
    validateContent(content)
    const meta = fileMetaFromPath(normalized)
    const now = Date.now()
    const file: WorkspaceFile & { id: string; workspaceId: string } = {
      id: `${workspaceId}:${normalized}`,
      workspaceId,
      path: normalized,
      content,
      ...meta,
      revision: (current?.revision ?? 0) + 1,
      updatedAt: now,
    }
    const db = await this.db
    const tx = db.transaction(['files', 'revisions'], 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('files').put(file)
    tx.objectStore('revisions').put({
      id: createId('revision'),
      fileId: file.id,
      workspaceId,
      path: normalized,
      revision: file.revision,
      content,
      createdAt: now,
    })
    await done
    await this.touchWorkspace(workspaceId)
    return file
  }

  async editFile(
    workspaceId: string,
    path: string,
    oldText: string,
    newText: string,
    expectedRevision: number,
  ): Promise<WorkspaceFile> {
    const current = await this.getFile(workspaceId, path)
    const normalized = requirePath(path)
    if (!current) throw new WorkspacePolicyError(`File does not exist: ${normalized}`)
    if (current.revision !== expectedRevision)
      throw new RevisionConflictError(normalized, expectedRevision, current.revision)
    if (!current.content.includes(oldText))
      throw new WorkspacePolicyError(`The expected text was not found in ${normalized}`)
    return this.writeFile(
      workspaceId,
      normalized,
      current.content.replace(oldText, newText),
      expectedRevision,
    )
  }

  async deleteFile(workspaceId: string, path: string): Promise<void> {
    const normalized = requirePath(path)
    const db = await this.db
    const tx = db.transaction('files', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('files').delete(`${workspaceId}:${normalized}`)
    await done
    await this.touchWorkspace(workspaceId)
  }

  async listRevisions(
    workspaceId: string,
    path: string,
  ): Promise<{ revision: number; content: string; createdAt: number }[]> {
    const normalized = requirePath(path)
    const db = await this.db
    const tx = db.transaction('revisions', 'readonly')
    const done = transactionDone(tx)
    const values = (await request(
      tx.objectStore('revisions').index('workspaceId').getAll(workspaceId),
    )) as { path: string; revision: number; content: string; createdAt: number }[]
    await done
    return values
      .filter((value) => value.path === normalized)
      .sort((a, b) => b.revision - a.revision)
  }

  async getWorkspaceStats(workspaceId: string): Promise<WorkspaceStats> {
    const files = await this.listFiles(workspaceId)
    return {
      files: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.content.length, 0),
      fileLimit: 1000,
      byteLimit: 10 * 1024 * 1024,
    }
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const db = await this.db
    const files = await this.listFiles(workspaceId)
    const tx = db.transaction(
      ['workspaces', 'files', 'revisions', 'sessions', 'messages', 'events'],
      'readwrite',
    )
    const done = transactionDone(tx)
    tx.objectStore('workspaces').delete(workspaceId)
    for (const file of files) tx.objectStore('files').delete(`${workspaceId}:${file.path}`)
    const revisions = await request(
      tx.objectStore('revisions').index('workspaceId').getAllKeys(workspaceId),
    )
    for (const key of revisions) tx.objectStore('revisions').delete(key)
    const sessions = await request(
      tx.objectStore('sessions').index('workspaceId').getAllKeys(workspaceId),
    )
    for (const key of sessions) {
      const sessionId = String(key)
      const messages = await request(
        tx.objectStore('messages').index('sessionId').getAllKeys(sessionId),
      )
      for (const messageKey of messages) tx.objectStore('messages').delete(messageKey)
      const events = await request(
        tx.objectStore('events').index('sessionId').getAllKeys(sessionId),
      )
      for (const eventKey of events) tx.objectStore('events').delete(eventKey)
      tx.objectStore('sessions').delete(key)
    }
    await done
  }

  async deleteSession(sessionId: string): Promise<void> {
    const db = await this.db
    const tx = db.transaction(['sessions', 'messages', 'events'], 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('sessions').delete(sessionId)
    const messages = await request(
      tx.objectStore('messages').index('sessionId').getAllKeys(sessionId),
    )
    for (const key of messages) tx.objectStore('messages').delete(key)
    const events = await request(tx.objectStore('events').index('sessionId').getAllKeys(sessionId))
    for (const key of events) tx.objectStore('events').delete(key)
    await done
  }

  async setSessionArchived(sessionId: string, archived: boolean): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) return
    const db = await this.db
    const tx = db.transaction('sessions', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('sessions').put({
      ...session,
      archivedAt: archived ? Date.now() : undefined,
      updatedAt: Date.now(),
    })
    await done
  }

  async renameSession(sessionId: string, title: string): Promise<SessionRecord | undefined> {
    const session = await this.getSession(sessionId)
    if (!session) return undefined
    const renamed: SessionRecord = { ...session, title: title.trim().slice(0, 80) || session.title }
    const db = await this.db
    const tx = db.transaction('sessions', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('sessions').put(renamed)
    await done
    return renamed
  }

  async grepWorkspace(workspaceId: string, query: GrepQuery): Promise<GrepResult> {
    const files = await this.listFiles(workspaceId)
    const token = ++grepToken
    const worker = getGrepWorker()
    worker.postMessage({
      type: 'load',
      token,
      files: files.map((file) => ({ path: file.path, content: file.content })),
    })
    return new Promise((resolve) => {
      grepWaiters.push({ resolve })
      worker.postMessage({ type: 'search', token, query })
    })
  }

  async appendMessage(message: ChatMessageRecord): Promise<void> {
    const db = await this.db
    const tx = db.transaction('messages', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('messages').put(message)
    await done
  }

  async listMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    const db = await this.db
    const tx = db.transaction('messages', 'readonly')
    const done = transactionDone(tx)
    const values = await request(tx.objectStore('messages').index('sessionId').getAll(sessionId))
    await done
    return (values as ChatMessageRecord[]).sort((a, b) => a.createdAt - b.createdAt)
  }

  async appendEvent(event: AgentEventRecord): Promise<void> {
    const db = await this.db
    const tx = db.transaction('events', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('events').put(event)
    await done
  }

  async listEvents(sessionId: string): Promise<AgentEventRecord[]> {
    const db = await this.db
    const tx = db.transaction('events', 'readonly')
    const done = transactionDone(tx)
    const values = await request(tx.objectStore('events').index('sessionId').getAll(sessionId))
    await done
    return (values as AgentEventRecord[]).sort((a, b) => a.createdAt - b.createdAt)
  }
}

function requirePath(path: string): string {
  const normalized = normalizeWorkspacePath(path)
  if (!normalized) throw new WorkspacePolicyError('Path must be a relative virtual workspace path')
  if (normalized.length > 240) throw new WorkspacePolicyError('Path is too long')
  const extension = /\.[^.]+$/.exec(normalized.toLowerCase())?.[0] ?? ''
  if (
    ['.py', '.sh', '.bash', '.ps1', '.bat', '.cmd', '.exe', '.dll', '.node'].includes(extension)
  ) {
    throw new WorkspacePolicyError(`Unsupported executable or server-side file type: ${extension}`)
  }
  return normalized
}

function validateContent(content: string): void {
  if (typeof content !== 'string') throw new WorkspacePolicyError('File content must be text')
  if (content.length > 1_048_576)
    throw new WorkspacePolicyError('A single file is limited to 1 MiB')
}

const seedFiles: Record<string, string> = {
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Browser workbench</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="hero">
      <p class="eyebrow">BROWSER AGENT / LOCAL PREVIEW</p>
      <h1>Build a small idea,<br /><span>see it immediately.</span></h1>
      <p class="lede">This project lives in your browser. Ask the agent to edit the virtual workspace, then inspect the isolated preview on the right.</p>
      <button id="demo-button">Test the page</button>
      <p id="demo-status" class="status">Ready for a click.</p>
    </main>
    <script src="main.js"></script>
  </body>
</html>`,
  'styles.css': `:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #e9edf5; background: #111827; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 85% 10%, #26334d 0, transparent 32%), #111827; }
.hero { max-width: 700px; min-height: 100vh; margin: auto; padding: 15vh 8vw; display: grid; align-content: center; gap: 18px; }
.eyebrow { margin: 0; color: #80a9ff; font-size: 12px; font-weight: 700; letter-spacing: .16em; }
h1 { margin: 0; font-size: clamp(42px, 7vw, 84px); line-height: .98; letter-spacing: -.05em; }
h1 span { color: #9ab8ff; }
.lede { max-width: 560px; margin: 0; color: #aeb9ce; font-size: 18px; line-height: 1.65; }
button { border: 0; border-radius: 10px; padding: 12px 18px; width: fit-content; color: #0f172a; background: #cfe0ff; font: inherit; font-weight: 700; cursor: pointer; }
button:hover { background: #fff; }
.status { margin: 0; color: #8592aa; font-size: 14px; }`,
  'main.js': `const button = document.querySelector('#demo-button');
const status = document.querySelector('#demo-status');
button?.addEventListener('click', () => {
  status.textContent = 'The isolated preview received the click.';
  button.textContent = 'It works';
});`,
}
