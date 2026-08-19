import { useState } from 'react'
import { ListTree, LoaderCircle, PlugZap, X } from 'lucide-react'
import type { AgentSettings } from '../../types'
import { fetchModelList, parseRequestHeaders, testModelConnection } from '../../model/client'

export interface SettingsModalProps {
  value: AgentSettings
  onClose: () => void
  onSave: (value: AgentSettings) => void
}

export function SettingsModal({ value, onClose, onSave }: SettingsModalProps) {
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
        <div className="modal-heading">
          <div><span className="eyebrow">运行时</span><h2>Agent 设置</h2></div>
          <button className="icon-button" title="关闭设置" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="settings-scroll">
          <label className="field-label">模型 API 地址<input value={draft.apiBaseUrl} onChange={event => patch({ apiBaseUrl: event.target.value })} placeholder="https://api.deepseek.com/v1" /></label>
          <label className="field-label">API Key<input type="password" value={draft.apiKey} onChange={event => patch({ apiKey: event.target.value })} placeholder="仅保存在本浏览器内" /></label>
          <label className="field-label">自定义请求头<small className="field-hint">JSON 对象，会合并到每个模型请求中，用于中转站要求特定请求头的场景（例如 &#123;"User-Agent": "codex-router/1.0.0"&#125;）。浏览器禁止的请求头会被忽略。</small><textarea value={draft.customHeaders} onChange={event => patch({ customHeaders: event.target.value })} rows={3} placeholder='{"User-Agent": "codex-router/1.0.0"}' /></label>
          {headerError && <div className="header-error">{headerError}</div>}
          <label className="field-label">模型<div className="model-row"><input value={draft.model} onChange={event => patch({ model: event.target.value })} placeholder="deepseek-chat" list="model-options" /><button className="secondary-button" disabled={listState === 'loading'} title="从 /models 接口拉取模型列表" onClick={() => void handleFetchModels()}>{listState === 'loading' ? <LoaderCircle size={13} className="spin" /> : <ListTree size={13} />}拉取模型</button></div>{models.length > 0 && <select className="model-picker" value={draft.model} onChange={event => patch({ model: event.target.value })}>{models.map(item => <option key={item} value={item}>{item}</option>)}</select>}<datalist id="model-options">{models.map(item => <option key={item} value={item} />)}</datalist>{listMessage && <span className="test-message">{listMessage}</span>}</label>
          <div className="test-row">
            <button className="secondary-button" disabled={testState === 'testing'} title="测试接口连通性" onClick={() => void handleTest()}>{testState === 'testing' ? <LoaderCircle size={13} className="spin" /> : <PlugZap size={13} />}测试连接</button>
            {testMessage && <span className={'test-message' + (testState === 'done' && testOk ? ' ok' : '')}>{testMessage}</span>}
          </div>
          <div className="settings-divider" />
          <div className="number-row">
            <label className="field-label">最大步数<input type="number" min={1} max={20} value={draft.maxSteps} onChange={event => patch({ maxSteps: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label>
            <label className="field-label">最大工具调用<input type="number" min={1} max={50} value={draft.maxToolCalls} onChange={event => patch({ maxToolCalls: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} /></label>
          </div>
        </div>
        <div className="modal-actions">
          <span className="security-note">API Key 永远不会进入预览页面或导出的 ZIP。</span>
          <button className="primary-button" onClick={() => { try { parseRequestHeaders(draft.customHeaders); onSave(draft) } catch (cause) { setHeaderError(cause instanceof Error ? cause.message : String(cause)) } }}>保存设置</button>
        </div>
      </section>
    </div>
  )
}
