import type { Rung, Standard } from '@shared/config'

export interface Binaries {
  ffmpeg: string
  ffprobe: string
  packager: string
}

export interface Fraction {
  num: number
  den: number
}

export interface SourceVideo {
  index: number
  codec: string
  // Coded dimensions and the square-pixel dimensions a player would display
  width: number
  height: number
  displayWidth: number
  displayHeight: number
  fps: Fraction
  bitrate: number | null
  bitrateEstimated: boolean
  pixelFormat: string | null
}

export interface SourceAudio {
  index: number
  codec: string
  channels: number
  channelLayout: string | null
  sampleRate: number | null
  bitrate: number | null
  language: string | null
  title: string | null
  isDefault: boolean
}

export interface SourceSubtitle {
  index: number
  codec: string
  language: string | null
  title: string | null
  isForced: boolean
  isImage: boolean
}

export interface SourceInfo {
  path: string
  sizeBytes: number
  durationSeconds: number
  containerBitrate: number | null
  video: SourceVideo
  audio: SourceAudio[]
  subtitles: SourceSubtitle[]
}

export interface RenditionPlan {
  label: string
  width: number
  height: number
  maxBitrateKbps: number
  gopFrames: number
  // Set when no configured rung applied and the source is served at its own size
  nativeFallback?: true
}

export type AudioAction = 'copy' | 'transcode'

export interface AudioPlan {
  sourceIndex: number
  action: AudioAction
  outputCodec: string
  channels: number
  bitrateKbps: number | null
  language: string
  name: string
  isDefault: boolean
}

export interface SkippedItem {
  kind: 'rendition' | 'audio' | 'subtitle'
  id: string
  reason: string
}

export interface EncodePlan {
  fps: Fraction
  segmentDurationSeconds: number
  // Exact segment length once the GOP is snapped to whole frames
  actualSegmentSeconds: number
  renditions: RenditionPlan[]
  audio: AudioPlan[]
  skipped: SkippedItem[]
}

export interface PlanOptions {
  rungs: Record<string, Rung>
  qualities: string[]
  segmentDurationSeconds: number
}

export type PipelineStep = 'probe' | 'plan' | 'encode' | 'package' | 'publish'

export interface ProgressEvent {
  step: PipelineStep
  // 0..100 within the step; undefined when the step cannot report progress
  stepPercent?: number
  // 0..100 across the whole pipeline
  percent: number
  message?: string
}

export interface PipelineInput {
  titleId: string
  name: string
  sourcePath: string
  outputRoot: string
  standards: Standard[]
  plan: PlanOptions
  videoEncoder?: VideoEncoderOptions
}

export interface VideoEncoderOptions {
  // libx264 preset; hardware encoders arrive in a later phase
  preset?: string
  crf?: number
}

export interface PipelineHooks {
  onProgress?: (event: ProgressEvent) => void
  onLog?: (line: string) => void
  signal?: AbortSignal
}

export interface PipelineResult {
  titleId: string
  outputFolder: string
  source: SourceInfo
  plan: EncodePlan
  metadata: TitleMetadata
}

export interface TitleMetadata {
  schemaVersion: 1
  titleId: string
  name: string
  durationSeconds: number
  standards: Standard[]
  manifests: Partial<Record<Standard, string>>
  segmentDurationSeconds: number
  renditions: MetadataRendition[]
  audioTracks: MetadataAudioTrack[]
  subtitleTracks: MetadataSubtitleTrack[]
  updatedAt: string
}

export interface MetadataRendition {
  label: string
  width: number
  height: number
  // Measured average in bps; maxBitrate is the encoder ceiling
  bitrate: number
  maxBitrate: number
  codec: string
  path: string
}

export interface MetadataAudioTrack {
  id: string
  language: string
  name: string
  codec: string
  channels: number
  path: string
}

export interface MetadataSubtitleTrack {
  id: string
  language: string
  name: string
  format: string
  path: string
}
