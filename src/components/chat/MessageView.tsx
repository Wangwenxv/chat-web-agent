import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Brain, Check, ChevronDown, Copy, FilePen, Wrench } from 'lucide-react'
import type {
  AgentEventRecord,
  ChatMessageRecord,
  ToolCallRequest,
  ToolExecutionResult,
} from '../../types'
import { getToolCallSummary } from '../../agent/runner'
import { MarkdownRenderer } from './MarkdownRenderer'

export function MessageView({
  message,
  events,
  showThinking,
}: {
  message: ChatMessageRecord
  events: AgentEventRecord[]
  showThinking: boolean
}) {
  if (message.role === 'tool') return null
  if (message.role === 'user') return <UserMessageView message={message} />
  if (message.toolCalls?.length) {
    return (
      <div className="assistant-block">
        {message.content && (
          <div className="assistant-copy">
            <MarkdownRenderer source={message.content} />
          </div>
        )}
        <div className="tool-stack">
          {message.toolCalls.map((call) => (
            <ToolCard key={call.id} call={call} events={events} />
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="assistant-block final-answer">
      {showThinking && message.thinking && <ThinkingBlock text={message.thinking} />}
      <div className="assistant-copy">
        <MarkdownRenderer source={message.content} />
      </div>
      {message.changedFiles?.length ? (
        <div className="changed-files">
          <span className="changed-files-label">
            <FilePen size={13} />
            修改了 {message.changedFiles.length} 个文件
          </span>
          <div className="changed-files-list">
            {message.changedFiles.map((path) => (
              <span className="changed-file-chip" key={path}>
                {path}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <MessageChrome text={message.content} time={message.createdAt} />
    </div>
  )
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="thinking-block"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Brain size={14} />
        <span>思考过程</span>
        <ChevronDown size={14} className="tool-chevron" />
      </summary>
      <div className="thinking-content">{text}</div>
    </details>
  )
}

function UserMessageView({ message }: { message: ChatMessageRecord }) {
  return (
    <div className="message-row user-row" data-time-hover-root>
      <div className="user-stack">
        <div className="user-bubble">
          <MarkdownRenderer source={message.content} />
          {message.attachments?.length ? (
            <div className="message-attachments">
              {message.attachments.map((attachment) =>
                attachment.mimeType.startsWith('image/') ? (
                  <img key={attachment.id} src={attachment.dataUrl} alt={attachment.name} />
                ) : (
                  <span key={attachment.id}>{attachment.name}</span>
                ),
              )}
            </div>
          ) : null}
        </div>
        <MessageChrome text={message.content} time={message.createdAt} clock="start" />
      </div>
    </div>
  )
}

function MessageChrome({
  text,
  time,
  clock = 'end',
}: {
  text: string
  time?: number
  clock?: 'start' | 'end'
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timerRef.current), [])
  const handleCopy = () => {
    if (copied) return
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        timerRef.current = setTimeout(() => setCopied(false), 1000)
      })
      .catch(() => undefined)
  }
  const clockEl =
    time === undefined ? null : (
      <span className={clock === 'start' ? 'msg-clock start' : 'msg-clock'}>
        {formatMessageClock(time)}
      </span>
    )
  return (
    <div className="msg-chrome">
      {clock === 'start' && clockEl}
      <button
        className="msg-action"
        title="复制"
        aria-label="复制"
        onClick={() => void handleCopy()}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {clock === 'end' && clockEl}
    </div>
  )
}

function formatMessageClock(time: number): string {
  const d = new Date(time)
  const now = new Date()
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
    return clock
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${clock}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${clock}`
}

function ToolCard({ call, events }: { call: ToolCallRequest; events: AgentEventRecord[] }) {
  const event = events.find(
    (item) =>
      item.type === 'tool_result' && (item.payload as { callId?: string }).callId === call.id,
  )
  const result = event?.payload as { result?: ToolExecutionResult } | undefined
  const ok = result?.result?.ok
  const state = ok === undefined ? 'running' : ok === false ? 'error' : 'ok'
  return (
    <details
      className={'tool-card' + (state === 'error' ? ' failed' : '')}
      data-state={state}
      open={ok === false}
    >
      <summary>
        <span className="tool-icon">
          {state === 'error' ? <AlertTriangle size={14} /> : <Wrench size={14} />}
        </span>
        <span className="tool-name">{getToolCallSummary(call)}</span>
        <span className="tool-summary">{toolSummary(result?.result)}</span>
        <ChevronDown size={14} className="tool-chevron" />
      </summary>
      {result?.result && <pre>{result.result.content.slice(0, 2800)}</pre>}
    </details>
  )
}

function toolSummary(result?: ToolExecutionResult): string {
  if (result?.ok === false) return result.error || '工具执行失败'
  if (result?.ok === true) return '完成'
  return '运行中'
}

export function EmptyConversation({ onPrompt }: { onPrompt: (value: string) => void }) {
  const prompts = [
    '做一个有悬浮交互的首页',
    '搜索一下浏览器 Agent 的最新资料',
    '读取当前文件并告诉我哪里可以改进',
  ]
  return (
    <div className="empty-conversation">
      <div className="empty-orbit">
        <Bot size={28} />
      </div>
      <h2>我们做点什么？</h2>
      <p>从一个小的网页创意开始。Agent 可以读取、写入、搜索并解释虚拟工作台中的文件。</p>
      <div className="prompt-grid">
        {prompts.map((prompt) => (
          <button key={prompt} onClick={() => onPrompt(prompt)}>
            {prompt}
            <span>↗</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function TurnStatus() {
  const [mountedAt] = useState(() => Date.now())
  const [elapsedMs, setElapsedMs] = useState(0)
  useEffect(() => {
    const tick = () => setElapsedMs(Date.now() - mountedAt)
    const id = setInterval(tick, 1000)
    tick()
    return () => clearInterval(id)
  }, [mountedAt])
  const showClock = elapsedMs >= 15000
  return (
    <div className="turn-status" role="status" aria-live="polite">
      Deep diving...
      {showClock && <span className="turn-status-clock">{formatRunDuration(elapsedMs)}</span>}
    </div>
  )
}

function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}
