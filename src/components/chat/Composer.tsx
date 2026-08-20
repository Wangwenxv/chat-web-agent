import { FilePlus2, Send, Square, X } from 'lucide-react'
import type { ChangeEvent, ClipboardEvent } from 'react'
import type { ChatAttachment } from '../../types'
import type { ReasoningOption } from '../../lib/reasoning'

export interface ComposerProps {
  value: string
  running: boolean
  disabled: boolean
  placeholder?: string
  multimodal?: boolean
  attachments: ChatAttachment[]
  model: string
  models: string[]
  reasoningOptions: ReasoningOption[]
  reasoningEffort: string
  onModelChange: (model: string) => void
  onReasoningChange: (key: string) => void
  onChange: (value: string) => void
  onAttachmentsChange: (attachments: ChatAttachment[]) => void
  onSend: () => void
  onStop: () => void
}

export function Composer({
  value,
  running,
  disabled,
  placeholder,
  multimodal = false,
  attachments,
  model,
  models,
  reasoningOptions,
  reasoningEffort,
  onModelChange,
  onReasoningChange,
  onChange,
  onAttachmentsChange,
  onSend,
  onStop,
}: ComposerProps) {
  const addFiles = (files: FileList | File[]) => {
    if (!multimodal) return
    const nextFiles = Array.from(files)
    const read = (file: File) =>
      new Promise<ChatAttachment | undefined>((resolve) => {
        if (file.size > 10 * 1024 * 1024) {
          resolve(undefined)
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : ''
          resolve(
            dataUrl
              ? {
                  id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
                  name: file.name || 'pasted-file',
                  mimeType: file.type || 'application/octet-stream',
                  size: file.size,
                  dataUrl,
                }
              : undefined,
          )
        }
        reader.onerror = () => resolve(undefined)
        reader.readAsDataURL(file)
      })
    void Promise.all(nextFiles.map(read)).then((result) => {
      const added = result.filter((item): item is ChatAttachment => item !== undefined)
      if (added.length > 0) onAttachmentsChange([...attachments, ...added])
    })
  }
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!multimodal) return
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) {
      for (const item of Array.from(event.clipboardData.items)) {
        const file = item.kind === 'file' ? item.getAsFile() : null
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      event.preventDefault()
      addFiles(files)
    }
  }
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files)
    event.target.value = ''
  }
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      <div className="composer-shell">
        <div className="composer-select-row">
          <ModelSelects
            model={model}
            models={models}
            reasoningOptions={reasoningOptions}
            reasoningEffort={reasoningEffort}
            disabled={disabled}
            onModelChange={onModelChange}
            onReasoningChange={onReasoningChange}
          />
        </div>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if ((value.trim() || attachments.length > 0) && !running) onSend()
            }
          }}
          placeholder={placeholder}
          rows={2}
          disabled={disabled}
        />
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <span className="attachment-chip" key={attachment.id}>
                {attachment.mimeType.startsWith('image/') ? (
                  <img src={attachment.dataUrl} alt="" />
                ) : (
                  <FilePlus2 size={13} />
                )}
                <span>{attachment.name}</span>
                <button
                  type="button"
                  title="移除附件"
                  onClick={() =>
                    onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-tools">
          <div className="composer-tools-left">
            {multimodal && (
              <label className="attachment-button" title="添加图片或附件">
                <FilePlus2 size={14} />
                <input type="file" multiple onChange={handleFileChange} disabled={disabled} />
              </label>
            )}
            <ModelSelects
              model={model}
              models={models}
              reasoningOptions={reasoningOptions}
              reasoningEffort={reasoningEffort}
              disabled={disabled}
              onModelChange={onModelChange}
              onReasoningChange={onReasoningChange}
            />
          </div>
          {running ? (
            <button
              type="button"
              className="send-button stop"
              title="停止当前回合"
              onClick={onStop}
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              title="发送消息"
              disabled={(!value.trim() && attachments.length === 0) || disabled}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

function ModelSelects({
  model,
  models,
  reasoningOptions,
  reasoningEffort,
  disabled,
  onModelChange,
  onReasoningChange,
}: {
  model: string
  models: string[]
  reasoningOptions: ReasoningOption[]
  reasoningEffort: string
  disabled: boolean
  onModelChange: (model: string) => void
  onReasoningChange: (key: string) => void
}) {
  return (
    <>
      <select
        className="composer-select composer-model-select"
        value={model}
        disabled={disabled}
        title="选择模型"
        onChange={(event) => onModelChange(event.target.value)}
      >
        {models.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      {reasoningOptions.length > 0 && (
        <select
          className="composer-select composer-reasoning-select"
          value={reasoningEffort}
          disabled={disabled}
          title="思考强度"
          onChange={(event) => onReasoningChange(event.target.value)}
        >
          <option value="off">思考：关闭</option>
          {reasoningOptions.map((item) => (
            <option key={item.key} value={item.key}>
              思考：{item.label}
            </option>
          ))}
        </select>
      )}
    </>
  )
}
