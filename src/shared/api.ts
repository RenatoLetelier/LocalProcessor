import type { AppConfig } from './config'
import type { AudioTrack, Job, Rendition, SubtitleTrack, Title } from './model'

export interface HealthResponse {
  status: 'ok'
  app: string
  version: string
  uptimeSeconds: number
}

export interface ApiError {
  statusCode: number
  error: string
  message: string
}

export interface FolderEntry {
  name: string
  kind: 'dir' | 'file' | 'segments'
  sizeBytes: number
  fileCount: number
  children?: FolderEntry[]
}

export interface TitleFilesResponse {
  root: string
  exists: boolean
  totalBytes: number
  fileCount: number
  entries: FolderEntry[]
}

export interface TitleDetail extends Title {
  renditions: Rendition[]
  audio_tracks: AudioTrack[]
  subtitle_tracks: SubtitleTrack[]
  jobs: Job[]
}

export interface CreateTitleResponse {
  title: Title
  job: Job
}

export type ServerEvent =
  | { type: 'snapshot'; jobs: Job[] }
  | { type: 'job.progress'; job: Job }
  | { type: 'job.updated'; job: Job }
  | { type: 'title.updated'; title: Title }
  | { type: 'title.deleted'; titleId: string }
  | { type: 'job.log'; jobId: string; line: string }
  | { type: 'config.updated'; config: AppConfig }
