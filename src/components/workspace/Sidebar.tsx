import type { CSSProperties, ReactNode, RefObject } from 'react'
import { CheckCircle2, ChevronDown, FolderPlus, FolderUp, PanelLeftClose, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react'
import type { WorkspaceRecord } from '../../types'

export interface SidebarProps {
  workspace: WorkspaceRecord
  workspaces: WorkspaceRecord[]
  fileCount: number
  workspaceMenuOpen: boolean
  pickerRef: RefObject<HTMLDivElement | null>
  sessionSections: ReactNode
  onToggleWorkspaceMenu: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onNewWorkspace: () => void
  onImportWorkspace: (file: File) => void
  onDeleteWorkspace: () => void
  onNewSession: () => void
  onOpenSettings: () => void
  onCollapse: () => void
  mobileOpen?: boolean
}

export function Sidebar(props: SidebarProps) {
  const { workspace, workspaces, fileCount, workspaceMenuOpen, pickerRef } = props
  const mobileStyle = props.mobileOpen === undefined ? undefined : {
    display: 'flex',
    pointerEvents: props.mobileOpen ? 'auto' : 'none',
    transform: props.mobileOpen ? 'translateX(0)' : 'translateX(-105%)',
    zIndex: 100,
  } as CSSProperties
  return (
    <aside className="sidebar" style={mobileStyle}>
      <div className="sidebar-section workspace-section">
        <div className="section-label">
          <span>工作区</span>
          <span className="sidebar-heading-actions">
            <button className="mini-button" title="新建工作区" onClick={props.onNewWorkspace}><Plus size={14} /></button>
            <button className="sidebar-toggle sidebar-inline-toggle" title="折叠侧栏" onClick={props.onCollapse}><PanelLeftClose size={15} /></button>
          </span>
        </div>
        <div className="workspace-picker" ref={pickerRef}>
          <button className={'workspace-select' + (workspaceMenuOpen ? ' is-open' : '')} aria-haspopup="listbox" aria-expanded={workspaceMenuOpen} onClick={props.onToggleWorkspaceMenu}>
            <Sparkles size={14} />
            <span className="workspace-select-text">{workspace.title}</span>
            <ChevronDown size={14} />
          </button>
          {workspaceMenuOpen && <div className="workspace-menu" role="listbox">
            {workspaces.map(item => (
              <button className={'workspace-option' + (item.id === workspace.id ? ' is-selected' : '')} role="option" aria-selected={item.id === workspace.id} key={item.id} onClick={() => props.onSelectWorkspace(item.id)}>
                <span>{item.title}</span>
                {item.id === workspace.id && <CheckCircle2 size={14} />}
              </button>
            ))}
          </div>}
        </div>
        <div className="workspace-meta"><span>{fileCount} 个文件</span><span>IndexedDB</span></div>
      </div>
      <div className="sidebar-section session-section">
        <div className="section-label"><span>会话</span><button className="mini-button" title="新建会话" onClick={props.onNewSession}><Plus size={14} /></button></div>
        {props.sessionSections}
      </div>
      <div className="sidebar-footer">
        <button className="sidebar-action" onClick={props.onNewWorkspace}><FolderPlus size={15} /><span>新建工作区</span></button>
        <label className="sidebar-action" title="导入工作区 ZIP"><FolderUp size={15} /><span>导入工作区</span><input className="hidden-file-input" type="file" accept=".zip,application/zip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) props.onImportWorkspace(file) }} /></label>
        <button className="sidebar-action" onClick={props.onDeleteWorkspace}><Trash2 size={15} /><span>删除工作区</span></button>
        <button className="sidebar-action" onClick={props.onOpenSettings}><Settings2 size={15} /><span>设置</span></button>
      </div>
    </aside>
  )
}
