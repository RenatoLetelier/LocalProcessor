import { useEffect, useState } from 'react'
import { bridge } from '@/lib/bridge'
import type { FolderEntry, TitleDetail, TitleFilesResponse } from '@shared/api'
import type { Title } from '@shared/model'
import { ConfirmDialog, EmptyState, StatusBadge, type ConfirmOptions } from '@/components/ui'
import { api } from '@/lib/api'
import { JOB_STATUS_LABEL, JOB_TIPO_LABEL, formatBitrate, formatBytes, formatDate, formatDuration } from '@/lib/format'
import { useAppState } from '@/state/AppState'

export function Library({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { titles } = useAppState()
  const selected = selectedId ? titles.find((t) => t.id === selectedId) : undefined

  // A title deleted elsewhere (API, another view) drops the detail back to the list
  useEffect(() => {
    if (selectedId && !selected) onSelect(null)
  }, [selectedId, selected, onSelect])

  if (selected) return <TitleView title={selected} onBack={() => onSelect(null)} />

  if (titles.length === 0) {
    return (
      <EmptyState title="Todavía no hay títulos">
        <p>Procesa una película desde la sección Procesar y aparecerá aquí.</p>
      </EmptyState>
    )
  }

  return (
    <div className="card">
      <table className="table table--clickable">
        <thead>
          <tr>
            <th>Título</th>
            <th>Estado</th>
            <th>Origen</th>
            <th>Duración</th>
            <th>Agregado</th>
          </tr>
        </thead>
        <tbody>
          {titles.map((title) => (
            <tr key={title.id} onClick={() => onSelect(title.id)}>
              <td>
                <div className="table__primary">{title.name}</div>
                <div className="table__note">{title.source_path}</div>
              </td>
              <td>
                <StatusBadge status={title.status} kind="title" />
              </td>
              <td className="muted">
                {title.source_width && title.source_height ? `${title.source_width}×${title.source_height}` : '—'}
                {title.source_video_codec ? ` · ${title.source_video_codec}` : ''}
              </td>
              <td className="muted">{formatDuration(title.duration_seconds)}</td>
              <td className="muted">{formatDate(title.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TitleView({ title, onBack }: { title: Title; onBack: () => void }) {
  const { deleteTitle } = useAppState()
  const [detail, setDetail] = useState<TitleDetail | null>(null)
  const [files, setFiles] = useState<TitleFilesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null)

  // Reloaded whenever the title row changes (status flips arrive over the WebSocket)
  useEffect(() => {
    let cancelled = false
    Promise.all([api.getTitle(title.id), api.getTitleFiles(title.id)])
      .then(([d, f]) => {
        if (cancelled) return
        setDetail(d)
        setFiles(f)
        setError(null)
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [title.id, title.status, title.updated_at])

  const askDelete = (): void =>
    setConfirm({
      title: 'Eliminar título',
      message: `Se borrará "${title.name}" de la biblioteca junto con su carpeta de salida. ${
        title.source_managed ? 'El archivo subido también se elimina.' : 'El archivo de origen no se toca.'
      }`,
      confirmLabel: 'Eliminar',
      danger: true,
      onConfirm: async () => {
        await deleteTitle(title.id)
        onBack()
      }
    })

  return (
    <div className="stack">
      <div className="detail-header">
        <button type="button" className="btn btn--link" onClick={onBack}>
          ← Biblioteca
        </button>
        <div className="detail-header__title">
          <h2>{title.name}</h2>
          <StatusBadge status={title.status} kind="title" />
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled={!files?.exists} onClick={() => void bridge.openFolder(title.output_folder)}>
            Abrir carpeta
          </button>
          <button type="button" className="btn" disabled title="Disponible en la fase 9">
            Reprocesar
          </button>
          <button type="button" className="btn btn--danger-outline" onClick={askDelete}>
            Eliminar
          </button>
        </div>
      </div>

      {title.error && <div className="alert alert--error">{title.error}</div>}
      {error && <div className="alert alert--error">{error}</div>}

      <div className="grid-2">
        <div className="card">
          <h3 className="card__title">Origen</h3>
          <dl className="props">
            <dt>Archivo</dt>
            <dd className="mono">{title.source_path}</dd>
            <dt>Video</dt>
            <dd>
              {title.source_width}×{title.source_height} · {title.source_video_codec ?? '—'} · {title.source_fps?.toFixed(3) ?? '—'} fps ·{' '}
              {formatBitrate(title.source_video_bitrate)}
            </dd>
            <dt>Duración</dt>
            <dd>{formatDuration(title.duration_seconds)}</dd>
            <dt>Agregado</dt>
            <dd>{formatDate(title.created_at)}</dd>
          </dl>
        </div>

        <div className="card">
          <h3 className="card__title">Salida</h3>
          <dl className="props">
            <dt>Carpeta</dt>
            <dd className="mono">{title.output_folder}</dd>
            <dt>Tamaño</dt>
            <dd>{files?.exists ? `${formatBytes(files.totalBytes)} · ${files.fileCount} archivos` : 'Todavía no publicada'}</dd>
          </dl>
        </div>
      </div>

      {detail && (
        <>
          <div className="card">
            <h3 className="card__title">Calidades ({detail.renditions.length})</h3>
            {detail.renditions.length === 0 ? (
              <p className="muted">Sin renditions todavía.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Etiqueta</th>
                    <th>Resolución</th>
                    <th>Bitrate medio</th>
                    <th>Códec</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.renditions.map((r) => (
                    <tr key={r.id}>
                      <td>{r.label}</td>
                      <td>{r.width}×{r.height}</td>
                      <td>{formatBitrate(r.bitrate)}</td>
                      <td>{r.video_codec}</td>
                      <td className="muted">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid-2">
            <div className="card">
              <h3 className="card__title">Audio ({detail.audio_tracks.length})</h3>
              {detail.audio_tracks.length === 0 ? (
                <p className="muted">Sin pistas registradas.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Idioma</th>
                      <th>Códec</th>
                      <th>Canales</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.audio_tracks.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {a.language ?? 'und'}
                          {a.title && <div className="table__note">{a.title}</div>}
                        </td>
                        <td>
                          {a.codec_origen}
                          {a.codec_salida && a.codec_salida !== a.codec_origen ? ` → ${a.codec_salida}` : ''}
                        </td>
                        <td>{a.channels ?? '—'}</td>
                        <td className="muted">{a.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h3 className="card__title">Subtítulos ({detail.subtitle_tracks.length})</h3>
              {detail.subtitle_tracks.length === 0 ? (
                <p className="muted">El origen no tiene subtítulos.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Idioma</th>
                      <th>Formato</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.subtitle_tracks.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.language ?? 'und'}
                          {s.title && <div className="table__note">{s.title}</div>}
                        </td>
                        <td>
                          {s.formato_origen}
                          {s.formato_salida ? ` → ${s.formato_salida}` : ''}
                        </td>
                        <td className="muted">
                          {s.status === 'done'
                            ? 'incluido'
                            : s.requiere_ocr
                              ? 'no incluido: subtítulo de imagen (requiere OCR)'
                              : s.status === 'error'
                                ? 'no incluido: formato no soportado'
                                : s.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {files?.exists && (
            <div className="card">
              <h3 className="card__title">Archivos</h3>
              <FileTree entries={files.entries} />
            </div>
          )}

          <div className="card">
            <h3 className="card__title">Jobs ({detail.jobs.length})</h3>
            <table className="table">
              <tbody>
                {detail.jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{JOB_TIPO_LABEL[job.tipo]}</td>
                    <td>
                      <StatusBadge status={job.status} kind="job" />
                    </td>
                    <td className="muted">{formatDate(job.created_at)}</td>
                    <td className="table__note">{job.error ?? (job.status === 'running' ? `${job.progress.toFixed(0)}%` : JOB_STATUS_LABEL[job.status])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirm && <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />}
    </div>
  )
}

function FileTree({ entries, depth = 0 }: { entries: FolderEntry[]; depth?: number }) {
  return (
    <ul className="tree">
      {entries.map((entry) => (
        <li key={entry.name} className="tree__item" style={{ paddingLeft: depth * 18 }}>
          <span className={`tree__icon tree__icon--${entry.kind}`} aria-hidden="true" />
          <span className="tree__name">
            {entry.kind === 'segments' ? `${entry.fileCount} segmentos (${entry.name})` : entry.name}
          </span>
          <span className="tree__size muted">{formatBytes(entry.sizeBytes)}</span>
          {entry.children && entry.children.length > 0 && <FileTree entries={entry.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}
