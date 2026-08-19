import type { RefObject } from 'react'
import { Download, RefreshCw, Trash2 } from 'lucide-react'
import { buildPreview } from '../../preview/build'

export interface PreviewPanelProps {
  artifact: ReturnType<typeof buildPreview>
  iframeRef: RefObject<HTMLIFrameElement | null>
  previewKey: number
  onRefresh: () => void
  onReset: () => void
  onDownload: () => void
}

export function PreviewPanel({ artifact, iframeRef, onRefresh, onReset, onDownload, previewKey }: PreviewPanelProps) {
  return (
    <div className="inspector-content preview-content">
      <div className="inspector-toolbar">
        <span className="toolbar-title"><span className="preview-pulse" />实时预览</span>
        <span className="preview-actions">
          <button className="icon-button tiny" title="从工作台文件重新构建预览" onClick={onRefresh}><RefreshCw size={14} /></button>
          <button className="icon-button tiny" title="重置沙箱 iframe" onClick={onReset}><Trash2 size={14} /></button>
          <button className="icon-button tiny" title="下载入口 HTML" onClick={onDownload}><Download size={14} /></button>
        </span>
      </div>
      <div className="preview-frame-wrap"><iframe key={previewKey} ref={iframeRef} title="沙箱项目预览" sandbox="allow-scripts" srcDoc={artifact.srcdoc} /></div>
    </div>
  )
}
