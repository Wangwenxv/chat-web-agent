import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export interface PromptOptions extends ConfirmOptions {
  defaultValue?: string
  placeholder?: string
  maxLength?: number
}

type DialogRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

let requestDialog: ((request: DialogRequest) => void) | undefined

// eslint-disable-next-line react-refresh/only-export-components
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => requestDialog?.({ kind: 'confirm', options, resolve }))
}
// eslint-disable-next-line react-refresh/only-export-components
export function showPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => requestDialog?.({ kind: 'prompt', options, resolve }))
}

export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestDialog = setRequest
    return () => {
      requestDialog = undefined
    }
  }, [])

  useEffect(() => {
    if (request?.kind === 'prompt') {
      const input = inputRef.current
      input?.focus()
      input?.select()
    }
  }, [request])

  if (!request) return null
  const isConfirm = request.kind === 'confirm'
  const close = (value: boolean | null) => {
    if (request.kind === 'confirm') request.resolve(value === true)
    else request.resolve(value === null ? null : String(value))
    setRequest(null)
  }
  const submit = () => {
    if (request.kind === 'prompt') {
      const value = inputRef.current?.value.trim() ?? ''
      if (!value) {
        inputRef.current?.focus()
        return
      }
      request.resolve(value)
    } else {
      request.resolve(true)
    }
    setRequest(null)
  }

  return (
    <div
      className="modal-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close(isConfirm ? false : null)
      }}
    >
      <section className="confirm-modal" role="dialog" aria-modal="true">
        <div className="modal-heading confirm-heading">
          <div className="confirm-title">
            <span className={'confirm-icon' + (request.options.danger ? ' danger' : '')}>
              <AlertTriangle size={16} />
            </span>
            <h2>{request.options.title}</h2>
          </div>
          <button
            className="icon-button"
            title="关闭"
            onClick={() => close(isConfirm ? false : null)}
          >
            <X size={16} />
          </button>
        </div>
        <div className="confirm-body">
          {request.options.message && <p className="confirm-message">{request.options.message}</p>}
          {request.kind === 'prompt' && (
            <input
              className="confirm-input"
              ref={inputRef}
              defaultValue={request.options.defaultValue ?? ''}
              placeholder={request.options.placeholder}
              maxLength={request.options.maxLength}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
                if (event.key === 'Escape') close(null)
              }}
            />
          )}
        </div>
        <div className="confirm-actions">
          <button className="secondary-button" onClick={() => close(isConfirm ? false : null)}>
            {request.options.cancelText ?? '取消'}
          </button>
          <button
            className={request.options.danger ? 'danger-button' : 'primary-button'}
            onClick={submit}
          >
            {request.options.confirmText ?? (isConfirm ? '确认' : '确定')}
          </button>
        </div>
      </section>
    </div>
  )
}
