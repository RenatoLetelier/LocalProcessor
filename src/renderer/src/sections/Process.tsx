import { useState, type DragEvent } from 'react'
import { bridge } from '@/lib/bridge'
import { ApiError } from '@/lib/api'
import { fileName } from '@/lib/format'
import { useAppState } from '@/state/AppState'
import type { SectionId } from '@/sections'

interface PendingFile {
  path: string
  status: 'pending' | 'queued' | 'error'
  message?: string
}

export function Process({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  const { config, enqueue } = useAppState()
  const [files, setFiles] = useState<PendingFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  const addPaths = (paths: string[]): void => {
    setFiles((list) => {
      const known = new Set(list.map((f) => f.path))
      const added = paths.filter((p) => p && !known.has(p)).map((path) => ({ path, status: 'pending' as const }))
      return [...list, ...added]
    })
  }

  const pick = async (): Promise<void> => addPaths(await bridge.pickVideoFiles())

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    addPaths(Array.from(event.dataTransfer.files).map((file) => bridge.pathForFile(file)))
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    for (const file of files.filter((f) => f.status === 'pending')) {
      try {
        await enqueue(file.path)
        setFiles((list) => list.map((f) => (f.path === file.path ? { ...f, status: 'queued' } : f)))
      } catch (error) {
        const message = error instanceof ApiError ? error.message : String(error)
        setFiles((list) => list.map((f) => (f.path === file.path ? { ...f, status: 'error', message } : f)))
      }
    }
    setBusy(false)
  }

  const pending = files.filter((f) => f.status === 'pending').length
  const enabledQualities = config?.qualities ?? []

  return (
    <div className="stack">
      <div
        className={`dropzone${dragging ? ' dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="dropzone__title">Arrastra películas aquí</p>
        <p className="dropzone__hint">o</p>
        <button type="button" className="btn btn--primary" onClick={() => void pick()}>
          Elegir archivos…
        </button>
      </div>

      {config && (
        <div className="card card--row">
          <div>
            <span className="muted">Se procesarán con la configuración actual: </span>
            <span className="chips">
              {config.standards.map((s) => (
                <span key={s} className="chip">{s.toUpperCase()}</span>
              ))}
              {enabledQualities.map((q) => (
                <span key={q} className="chip">{q}</span>
              ))}
              <span className="chip">segmentos de {config.segmentDurationSeconds} s</span>
            </span>
          </div>
          <button type="button" className="btn btn--link" onClick={() => onNavigate('settings')}>
            Cambiar
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="card">
          <ul className="file-list">
            {files.map((file) => (
              <li key={file.path} className={`file-list__item file-list__item--${file.status}`}>
                <div className="file-list__main">
                  <span className="file-list__name">{fileName(file.path)}</span>
                  <span className="file-list__path">{file.path}</span>
                  {file.message && <span className="file-list__message">{file.message}</span>}
                </div>
                <span className="file-list__status">
                  {file.status === 'queued' ? 'En cola' : file.status === 'error' ? 'Rechazado' : ''}
                </span>
                {!busy && (
                  <button
                    type="button"
                    className="btn btn--icon"
                    aria-label="Quitar"
                    onClick={() => setFiles((list) => list.filter((f) => f.path !== file.path))}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="btn btn--primary" disabled={pending === 0 || busy} onClick={() => void submit()}>
              {busy ? 'Encolando…' : `Encolar ${pending} ${pending === 1 ? 'archivo' : 'archivos'}`}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setFiles((list) => list.filter((f) => f.status === 'pending'))}>
              Limpiar terminados
            </button>
            {files.some((f) => f.status === 'queued') && (
              <button type="button" className="btn btn--link" onClick={() => onNavigate('jobs')}>
                Ver jobs →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
