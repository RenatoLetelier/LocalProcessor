import { useEffect, useState, type ReactNode } from 'react'
import type { JobStatus, TitleStatus } from '@shared/model'
import { JOB_STATUS_LABEL, TITLE_STATUS_LABEL } from '@/lib/format'

export function ProgressBar({ percent, tone = 'accent' }: { percent: number; tone?: 'accent' | 'muted' }) {
  return (
    <div className={`progress progress--${tone}`} role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  )
}

const TONE: Record<TitleStatus | JobStatus, string> = {
  queued: 'muted',
  processing: 'accent',
  running: 'accent',
  done: 'ok',
  error: 'error',
  cancelled: 'warn'
}

export function StatusBadge({ status, kind }: { status: TitleStatus | JobStatus; kind: 'title' | 'job' }) {
  const label = kind === 'title' ? TITLE_STATUS_LABEL[status as TitleStatus] : JOB_STATUS_LABEL[status as JobStatus]
  return <span className={`badge badge--${TONE[status]}`}>{label}</span>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children && <div className="empty__body">{children}</div>}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title" className="modal__title">{title}</h2>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  )
}

export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
}

export function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await options.onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={options.title}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className={`btn ${options.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => void confirm()} disabled={busy}>
            {options.confirmLabel ?? 'Confirmar'}
          </button>
        </>
      }
    >
      <p>{options.message}</p>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  )
}
