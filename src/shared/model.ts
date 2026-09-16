// Row shapes as stored in SQLite and returned by the API. Column names follow
// the ER diagram of docs/documentacion-tecnica.md verbatim (mixed es/en included).

export type TitleStatus = 'queued' | 'processing' | 'done' | 'error'
export type ArtifactStatus = 'pending' | 'processing' | 'done' | 'error'
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type JobTipo = 'inicial' | 'agregar_calidad' | 'agregar_pista' | 'reprocesar_completo'

export interface Title {
  id: string
  name: string
  source_path: string
  source_hash: string | null
  source_width: number | null
  source_height: number | null
  source_video_bitrate: number | null
  source_fps: number | null
  source_video_codec: string | null
  duration_seconds: number | null
  output_folder: string
  // True when the source file was uploaded through the API and is ours to delete
  source_managed: boolean
  status: TitleStatus
  error: string | null
  created_at: string
  updated_at: string
}

export interface Rendition {
  id: string
  title_id: string
  label: string
  width: number
  height: number
  bitrate: number
  video_codec: string
  status: ArtifactStatus
}

export interface AudioTrack {
  id: string
  title_id: string
  source_index: number
  language: string | null
  title: string | null
  codec_origen: string
  codec_salida: string | null
  channels: number | null
  status: ArtifactStatus
}

export interface SubtitleTrack {
  id: string
  title_id: string
  source_index: number
  language: string | null
  title: string | null
  formato_origen: string
  formato_salida: string | null
  requiere_ocr: boolean
  status: ArtifactStatus
}

export interface Job {
  id: string
  title_id: string
  tipo: JobTipo
  status: JobStatus
  config_json: string
  progress: number
  current_step: string | null
  error: string | null
  attempts: number
  created_at: string
  started_at: string | null
  finished_at: string | null
}
