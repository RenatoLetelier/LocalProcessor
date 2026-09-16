import { useState } from 'react'
import type { ReprocessFile, ReprocessRequest, TitleDetail } from '@shared/api'
import type { Title } from '@shared/model'
import { Modal } from '@/components/ui'
import { ApiError, api } from '@/lib/api'
import { bridge } from '@/lib/bridge'
import { fileName } from '@/lib/format'
import { useAppState } from '@/state/AppState'

type Mode = ReprocessRequest['tipo']

interface FileRow extends ReprocessFile {
  id: number
}

// Same rule as the planner: a rung is upscaling when the source is smaller in both dimensions
const wouldUpscale = (w: number, h: number, box: { width: number; height: number }): boolean => w < box.width && h < box.height

export function ReprocessDialog({ title, detail, onClose, onQueued }: { title: Title; detail: TitleDetail; onClose: () => void; onQueued: () => void }) {
  const { config } = useAppState()
  const [mode, setMode] = useState<Mode>('agregar_calidad')
  const [qualities, setQualities] = useState<string[]>([])
  const [retryAudio, setRetryAudio] = useState<number[]>([])
  const [retrySubtitles, setRetrySubtitles] = useState<number[]>([])
  const [files, setFiles] = useState<FileRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  if (!config) return null

  const done = new Set(detail.renditions.filter((r) => r.status === 'done').map((r) => r.label))
  const candidates = Object.entries(config.rungs).map(([label, rung]) => {
    const upscale = title.source_width && title.source_height ? wouldUpscale(title.source_width, title.source_height, rung) : false
    return { label, rung, disabled: done.has(label) || upscale, reason: done.has(label) ? 'ya existe' : upscale ? 'sería upscaling' : '' }
  })
  const retryableAudio = detail.audio_tracks.filter((a) => a.status === 'error')
  const retryableSubtitles = detail.subtitle_tracks.filter((s) => s.status === 'error' && !s.requiere_ocr)

  const toggle = (list: number[], value: number, on: boolean): number[] => (on ? [...new Set([...list, value])] : list.filter((v) => v !== value))

  const addFiles = async (kind: 'audio' | 'subtitle'): Promise<void> => {
    const paths = await bridge.pickTrackFiles(kind)
    setFiles((list) => [
      ...list,
      ...paths
        .filter((p) => !list.some((f) => f.path === p))
        .map((path, i) => ({ id: Date.now() + i, path, kind, language: '', name: '', forced: false }))
    ])
  }

  const updateFile = (id: number, patch: Partial<ReprocessFile>): void => setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const request = (): ReprocessRequest => {
    if (mode === 'agregar_calidad') return { tipo: mode, qualities }
    if (mode === 'agregar_pista') {
      return {
        tipo: mode,
        audio: retryAudio,
        subtitles: retrySubtitles,
        files: files.map(({ id: _id, ...file }) => ({
          path: file.path,
          kind: file.kind,
          ...(file.language ? { language: file.language } : {}),
          ...(file.name ? { name: file.name } : {}),
          ...(file.kind === 'subtitle' && file.forced ? { forced: true } : {})
        }))
      }
    }
    return { tipo: mode }
  }

  const canSubmit =
    mode === 'reprocesar_completo' ||
    (mode === 'agregar_calidad' && qualities.length > 0) ||
    (mode === 'agregar_pista' && retryAudio.length + retrySubtitles.length + files.length > 0)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProblems([])
    try {
      await api.reprocessTitle(title.id, request())
      onQueued()
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message)
        if (Array.isArray(e.body.problems)) setProblems(e.body.problems as string[])
      } else setError(String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Reprocesar "${title.name}"`}
      wide
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={busy || !canSubmit}>
            {busy ? 'Encolando…' : 'Encolar'}
          </button>
        </>
      }
    >
      <div className="segmented" role="tablist">
        {(
          [
            ['agregar_calidad', 'Agregar calidad'],
            ['agregar_pista', 'Agregar pista'],
            ['reprocesar_completo', 'Reprocesar completo']
          ] as [Mode, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} className={`segmented__item${mode === id ? ' segmented__item--active' : ''}`} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'agregar_calidad' && (
        <div className="stack-sm">
          <p className="muted">Solo se codifica la calidad nueva; las existentes y las pistas no se tocan. Usa la misma duración de segmento del título.</p>
          <div className="checks">
            {candidates.map(({ label, rung, disabled, reason }) => (
              <label key={label} className={`check${disabled ? ' check--disabled' : ''}`}>
                <input type="checkbox" disabled={disabled} checked={qualities.includes(label)} onChange={(e) => setQualities((q) => (e.target.checked ? [...q, label] : q.filter((x) => x !== label)))} />
                <span>
                  <strong>{label}</strong> <span className="muted">{rung.width}×{rung.height}{reason ? ` — ${reason}` : ''}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {mode === 'agregar_pista' && (
        <div className="stack-sm">
          {retryableAudio.length + retryableSubtitles.length > 0 && (
            <>
              <p className="muted">Pistas del origen que fallaron y se pueden reintentar:</p>
              <div className="checks">
                {retryableAudio.map((a) => (
                  <label key={a.id} className="check">
                    <input type="checkbox" checked={retryAudio.includes(a.source_index)} onChange={(e) => setRetryAudio((l) => toggle(l, a.source_index, e.target.checked))} />
                    <span>Audio {a.language ?? 'und'} · {a.codec_origen}</span>
                  </label>
                ))}
                {retryableSubtitles.map((s) => (
                  <label key={s.id} className="check">
                    <input type="checkbox" checked={retrySubtitles.includes(s.source_index)} onChange={(e) => setRetrySubtitles((l) => toggle(l, s.source_index, e.target.checked))} />
                    <span>Subtítulo {s.language ?? 'und'} · {s.formato_origen}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          <p className="muted">Archivos externos (un subtítulo descargado, un doblaje en otro idioma):</p>
          <div className="actions actions--tight">
            <button type="button" className="btn btn--sm" onClick={() => void addFiles('subtitle')}>
              Agregar subtítulo…
            </button>
            <button type="button" className="btn btn--sm" onClick={() => void addFiles('audio')}>
              Agregar audio…
            </button>
          </div>
          {files.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Idioma</th>
                  <th>Nombre</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <div className="table__primary">{fileName(file.path)}</div>
                      <div className="table__note">{file.kind === 'subtitle' ? 'subtítulo' : 'audio'}</div>
                    </td>
                    <td>
                      <input className="input input--xs" placeholder="es, en, pt-br…" value={file.language ?? ''} onChange={(e) => updateFile(file.id, { language: e.target.value.trim() })} />
                    </td>
                    <td>
                      <input className="input" placeholder="Opcional" value={file.name ?? ''} onChange={(e) => updateFile(file.id, { name: e.target.value })} />
                      {file.kind === 'subtitle' && (
                        <label className="check check--inline">
                          <input type="checkbox" checked={file.forced ?? false} onChange={(e) => updateFile(file.id, { forced: e.target.checked })} />
                          <span className="muted">forzado</span>
                        </label>
                      )}
                    </td>
                    <td className="table__actions">
                      <button type="button" className="btn btn--icon" aria-label="Quitar" onClick={() => setFiles((l) => l.filter((f) => f.id !== file.id))}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted">Los subtítulos de imagen (PGS, VobSub) no se pueden agregar: requieren OCR.</p>
        </div>
      )}

      {mode === 'reprocesar_completo' && (
        <div className="stack-sm">
          <p>Se vuelve a generar todo el título con la configuración actual y se reemplaza la carpeta publicada al final. Las pistas externas ya agregadas se conservan.</p>
          <p className="chips">
            {config.standards.map((s) => (
              <span key={s} className="chip">{s.toUpperCase()}</span>
            ))}
            {config.qualities.map((q) => (
              <span key={q} className="chip">{q}</span>
            ))}
            <span className="chip">segmentos de {config.segmentDurationSeconds} s</span>
          </p>
          <p className="muted">Es el único reprocesado que acepta un archivo de origen reemplazado.</p>
        </div>
      )}

      {error && (
        <div className="alert alert--error">
          {problems.length > 0 ? (
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            error
          )}
        </div>
      )}
    </Modal>
  )
}
