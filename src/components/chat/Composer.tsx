import { Send, Square, Wrench } from 'lucide-react'

export interface ComposerProps {
  value: string
  running: boolean
  disabled: boolean
  placeholder?: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
}

export function Composer({ value, running, disabled, placeholder, onChange, onSend, onStop }: ComposerProps) {
  return (
    <form className="composer" onSubmit={event => { event.preventDefault(); onSend() }}>
      <div className="composer-shell">
        <textarea
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (value.trim() && !running) onSend()
            }
          }}
          placeholder={placeholder}
          rows={2}
          disabled={disabled}
        />
        <div className="composer-tools">
          <span className="composer-hint"><Wrench size={13} /> 工具只在本工作台内运行</span>
          {running
            ? <button type="button" className="send-button stop" title="停止当前回合" onClick={onStop}><Square size={15} fill="currentColor" /></button>
            : <button type="submit" className="send-button" title="发送消息" disabled={!value.trim() || disabled}><Send size={16} /></button>}
        </div>
      </div>
    </form>
  )
}
