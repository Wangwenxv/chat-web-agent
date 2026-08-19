import { Archive, ArchiveRestore, MessageCircle, Trash2 } from 'lucide-react'
import type { SessionRecord } from '../../types'

export function SessionList({ sessions, activeSessionId, onSelect, onArchive, onDelete, archived = false }: {
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
