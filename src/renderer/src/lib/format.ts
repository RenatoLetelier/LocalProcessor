import type { JobStatus, JobTipo, TitleStatus } from '@shared/model'

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('es', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

export function formatBitrate(bps: number | null | undefined): string {
  if (!bps) return '—'
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toLocaleString('es', { maximumFractionDigits: 1 })} Mbps` : `${Math.round(bps / 1000)} kbps`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })
}

export function formatElapsed(fromIso: string | null | undefined, toIso?: string | null): string {
  if (!fromIso) return '—'
  const ms = (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime()
  return formatDuration(ms / 1000)
}

export const TITLE_STATUS_LABEL: Record<TitleStatus, string> = {
  queued: 'En cola',
  processing: 'Procesando',
  done: 'Listo',
  error: 'Error'
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'En cola',
  running: 'En curso',
  done: 'Completado',
  error: 'Error',
  cancelled: 'Cancelado'
}

export const JOB_TIPO_LABEL: Record<JobTipo, string> = {
  inicial: 'Procesado inicial',
  agregar_calidad: 'Agregar calidad',
  agregar_pista: 'Agregar pista',
  reprocesar_completo: 'Reprocesado completo'
}

export const STEP_LABEL: Record<string, string> = {
  probe: 'Analizando origen',
  plan: 'Planificando',
  encode: 'Codificando',
  package: 'Empaquetando',
  publish: 'Publicando'
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
