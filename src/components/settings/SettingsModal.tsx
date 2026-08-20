import { useState } from 'react'
import { ListTree, LoaderCircle, PlugZap, X } from 'lucide-react'
import type { AgentSettings, PreviewPermissions } from '../../types'
import { fetchModelList, parseRequestHeaders, testModelConnection } from '../../model/client'

export interface SettingsModalProps {
  value: AgentSettings
  permissions: PreviewPermissions
  onClose: () => void
  onSave: (value: AgentSettings, permissions: PreviewPermissions) => void
  onModelsChange?: (models: string[]) => void
}

const PERMISSION_ITEMS: { key: keyof PreviewPermissions; label: string; hint: string }[] = [
  {
    key: 'allowSameOrigin',
    label: '同源访问',
    hint: 'localStorage / IndexedDB / Cookie 等本地存储',
  },
  { key: 'allowNetwork', label: '网络请求', hint: 'fetch / XHR / WebSocket 访问外网' },
  { key: 'allowExternalScripts', label: '外链脚本与样式', hint: 'CDN 的 <script> / <link> 资源' },
  { key: 'allowExternalImages', label: '外链图片', hint: '<img> 的 https 图片来源' },
  { key: 'allowExternalFonts', label: '外链字体', hint: '@font-face 的 https 字体来源' },
  { key: 'allowModals', label: '对话框', hint: 'alert / confirm / prompt' },
  { key: 'allowPopups', label: '弹窗', hint: 'window.open 新窗口' },
  { key: 'allowDownloads', label: '下载', hint: 'a[download] 与 Blob 下载' },
  { key: 'allowForms', label: '表单提交', hint: '<form> 提交与导航' },
  { key: 'allowFullscreen', label: '全屏', hint: 'requestFullscreen' },
  { key: 'allowClipboard', label: '剪贴板', hint: 'navigator.clipboard 写入' },
  { key: 'allowMicrophone', label: '麦克风', hint: 'getUserMedia 录音' },
  { key: 'allowCamera', label: '摄像头', hint: 'getUserMedia 视频' },
  { key: 'allowEval', label: '动态代码', hint: 'eval / new Function' },
]

export function SettingsModal({
  value,
  permissions,
  onClose,
  onSave,
  onModelsChange,
}: SettingsModalProps) {
  const [draft, setDraft] = useState(value)
  const [permDraft, setPermDraft] = useState(permissions)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'done'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [testOk, setTestOk] = useState(false)
  const [listState, setListState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [listMessage, setListMessage] = useState('')
  const [models, setModels] = useState<string[]>(value.modelList)
  const [headerError, setHeaderError] = useState('')
  const patch = (next: Partial<AgentSettings>) => setDraft((current) => ({ ...current, ...next }))
  const togglePermission = (key: keyof PreviewPermissions) =>
    setPermDraft((current) => ({ ...current, [key]: !current[key] }))

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
    try {
      const fetched = await fetchModelList(draft)
      if (fetched.length === 0) {
        setListMessage('接口已响应，但未返回任何模型。')
      } else {
        const merged = Array.from(new Set([...models, ...fetched])).sort()
        setModels(merged)
        onModelsChange?.(merged)
        if (!merged.includes(draft.model)) patch({ model: fetched[0] })
        setListMessage(`找到 ${fetched.length} 个模型。`)
      }
    } catch (cause) {
      setListMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setListState('done')
    }
  }

  return (
    <div
      className="modal-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="settings-modal">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">运行时</span>
            <h2>Agent 设置</h2>
          </div>
          <button className="icon-button" title="关闭设置" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="settings-scroll">
          <label className="field-label">
            模型 API 地址
            <input
              value={draft.apiBaseUrl}
              onChange={(event) => patch({ apiBaseUrl: event.target.value })}
              placeholder="https://api.deepseek.com/v1"
            />
          </label>
          <label className="field-label">
            API Key
            <input
              type="password"
              value={draft.apiKey}
              onChange={(event) => patch({ apiKey: event.target.value })}
              placeholder="仅保存在本浏览器内"
            />
          </label>
          <label className="field-label">
            自定义请求头
            <small className="field-hint">
              JSON 对象，会合并到每个模型请求中，用于中转站要求特定请求头的场景（例如
              &#123;"User-Agent": "codex-router/1.0.0"&#125;）。浏览器禁止的请求头会被忽略。
            </small>
            <textarea
              value={draft.customHeaders}
              onChange={(event) => patch({ customHeaders: event.target.value })}
              rows={3}
              placeholder='{"User-Agent": "codex-router/1.0.0"}'
            />
          </label>
          {headerError && <div className="header-error">{headerError}</div>}
          <label className="field-label">
            模型
            <div className="model-row">
              <input
                value={draft.model}
                onChange={(event) => patch({ model: event.target.value })}
                placeholder="deepseek-chat"
                list="model-options"
              />
              <button
                className="secondary-button"
                disabled={listState === 'loading'}
                title="从 /models 接口拉取模型列表"
                onClick={() => void handleFetchModels()}
              >
                {listState === 'loading' ? (
                  <LoaderCircle size={13} className="spin" />
                ) : (
                  <ListTree size={13} />
                )}
                拉取模型
              </button>
            </div>
            {models.length > 0 && (
              <select
                className="model-picker"
                value={draft.model}
                onChange={(event) => patch({ model: event.target.value })}
              >
                {models.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            )}
            <datalist id="model-options">
              {models.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <small className="field-hint">
              模型列表缓存，可手动增删（每行一个）。拉取模型会合并接口返回的列表。
            </small>
            <textarea
              className="model-list-editor"
              value={models.join('\n')}
              onChange={(event) => {
                const next = event.target.value
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean)
                setModels(next)
                onModelsChange?.(next)
              }}
              rows={4}
              placeholder={'deepseek-chat\ndeepseek-reasoner\nclaude-sonnet-4-5'}
            />
            {listMessage && <span className="test-message">{listMessage}</span>}
          </label>
          <label className="field-label">
            思考强度选项
            <small className="field-hint">
              按模型定义思考强度键值，每行一条规则。格式：模型匹配词 | 键:名称,键:名称。
              不匹配任何规则时使用默认低/中/高。例如：deepseek|low:低,medium:中,high:高,max:最大。
            </small>
            <textarea
              className="model-list-editor"
              value={draft.reasoningOptions}
              onChange={(event) => patch({ reasoningOptions: event.target.value })}
              rows={4}
              placeholder={
                'deepseek|low:低,medium:中,high:高,max:最大\no3|low:低,medium:中,high:高,xhigh:超高\nclaude|low:低,medium:中,high:高,ultra:极致'
              }
            />
          </label>
          <div className="test-row">
            <button
              className="secondary-button"
              disabled={testState === 'testing'}
              title="测试接口连通性"
              onClick={() => void handleTest()}
            >
              {testState === 'testing' ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <PlugZap size={13} />
              )}
              测试连接
            </button>
            {testMessage && (
              <span className={'test-message' + (testState === 'done' && testOk ? ' ok' : '')}>
                {testMessage}
              </span>
            )}
            <label
              className={
                'setting-toggle multimodal-toggle' + (draft.supportsMultimodal ? ' is-on' : '')
              }
            >
              <input
                type="checkbox"
                checked={draft.supportsMultimodal}
                onChange={(event) => patch({ supportsMultimodal: event.target.checked })}
              />
              <span>
                <strong>支持多模态</strong>
                <small>图片与附件</small>
              </span>
            </label>
            <label
              className={'setting-toggle multimodal-toggle' + (draft.showThinking ? ' is-on' : '')}
            >
              <input
                type="checkbox"
                checked={draft.showThinking}
                onChange={(event) => patch({ showThinking: event.target.checked })}
              />
              <span>
                <strong>显示思考内容</strong>
                <small>reasoning_content 思考过程</small>
              </span>
            </label>
          </div>
          <div className="settings-divider" />
          <div className="permission-heading">
            <div>
              <span className="eyebrow">沙箱</span>
              <h3>预览权限</h3>
            </div>
            <span className="field-hint">
              预览页面可使用的能力开关，默认全部开启。关闭后对应能力将不可用。
            </span>
          </div>
          <div className="permission-grid">
            {PERMISSION_ITEMS.map((item) => (
              <label
                className={'setting-toggle' + (permDraft[item.key] ? ' is-on' : '')}
                key={item.key}
              >
                <input
                  type="checkbox"
                  checked={permDraft[item.key]}
                  onChange={() => togglePermission(item.key)}
                />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <span className="security-note">API Key 永远不会进入预览页面或导出的 ZIP。</span>
          <button
            className="primary-button"
            onClick={() => {
              try {
                parseRequestHeaders(draft.customHeaders)
                onSave(draft, permDraft)
              } catch (cause) {
                setHeaderError(cause instanceof Error ? cause.message : String(cause))
              }
            }}
          >
            保存设置
          </button>
        </div>
      </section>
    </div>
  )
}
