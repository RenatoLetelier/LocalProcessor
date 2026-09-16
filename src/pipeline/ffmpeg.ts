import { join } from 'node:path'
import { run } from './exec'
import { encodedAudioFile, encodedSubtitleFile, encodedVideoFile } from './layout'
import type {
  AudioPlan,
  Binaries,
  EncodePlan,
  RenditionPlan,
  SkippedItem,
  SourceInfo,
  SubtitlePlan,
  TrackInput,
  VideoEncoderOptions
} from './types'

export const DEFAULT_VIDEO_ENCODER: Required<VideoEncoderOptions> = { preset: 'medium', crf: 20 }

export interface EncodeOutputs {
  video: { label: string; file: string }[]
  audio: { sourceIndex: number; file: string }[]
}

// One ffmpeg invocation decodes the source once and writes every rendition and
// audio track as separate MP4 intermediates for the packager. External track
// files are extra inputs of the same run.
export function buildFfmpegArgs(
  source: SourceInfo,
  plan: EncodePlan,
  encDir: string,
  encoder: VideoEncoderOptions = {}
): { args: string[]; outputs: EncodeOutputs } {
  const opts = { ...DEFAULT_VIDEO_ENCODER, ...encoder }
  const inputs = new InputList(source.path)
  for (const audio of plan.audio) inputs.add(audio.input.path)

  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1']
  for (const path of inputs.paths) args.push('-i', path)
  const outputs: EncodeOutputs = { video: [], audio: [] }

  const videoInput = `0:${source.video.index}`
  const labels = plan.renditions.map((r) => `[v_${r.label}]`)
  if (plan.renditions.length > 1) {
    const chain = plan.renditions.map((r) => `[s_${r.label}]${scaleFilter(r)}[v_${r.label}]`)
    args.push(
      '-filter_complex',
      `[${videoInput}]split=${plan.renditions.length}${labels.map((l) => l.replace('v_', 's_')).join('')};${chain.join(';')}`
    )
  }

  plan.renditions.forEach((rendition, i) => {
    const file = join(encDir, encodedVideoFile(rendition.label))
    if (plan.renditions.length > 1) args.push('-map', labels[i]!)
    else args.push('-map', videoInput, '-vf', scaleFilter(rendition))
    args.push(...videoCodecArgs(rendition, plan, opts), '-an', '-sn', '-dn', '-map_metadata', '-1', '-f', 'mp4', file)
    outputs.video.push({ label: rendition.label, file })
  })

  for (const audio of plan.audio) {
    const file = join(encDir, encodedAudioFile(audio.sourceIndex))
    args.push('-map', inputs.map(audio.input), ...audioCodecArgs(audio), '-vn', '-sn', '-dn', '-map_metadata', '-1', '-f', 'mp4', file)
    outputs.audio.push({ sourceIndex: audio.sourceIndex, file })
  }

  return { args, outputs }
}

// Distinct input files of a run, in first-use order; the title source is always input 0
class InputList {
  readonly paths: string[]

  constructor(primary: string) {
    this.paths = [primary]
  }

  add(path: string | undefined): void {
    if (path && !this.paths.includes(path)) this.paths.push(path)
  }

  map(input: TrackInput): string {
    const index = input.path ? this.paths.indexOf(input.path) : 0
    return `${index}:${input.streamIndex}`
  }
}

// setsar=1 turns anamorphic sources into square pixels at the display size
function scaleFilter(rendition: RenditionPlan): string {
  return `scale=${rendition.width}:${rendition.height}:flags=bicubic,setsar=1`
}

function videoCodecArgs(rendition: RenditionPlan, plan: EncodePlan, opts: Required<VideoEncoderOptions>): string[] {
  const { gopFrames, maxBitrateKbps } = rendition
  return [
    '-c:v', 'libx264',
    '-preset', opts.preset,
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    // Capped CRF: constant quality, never above the rung ceiling
    '-crf', String(opts.crf),
    '-maxrate', `${maxBitrateKbps}k`,
    '-bufsize', `${maxBitrateKbps * 2}k`,
    // Fixed GOP with no scene-cut keyframes so every rendition cuts on the same frames
    '-g', String(gopFrames),
    '-keyint_min', String(gopFrames),
    '-sc_threshold', '0',
    '-r', `${plan.fps.num}/${plan.fps.den}`,
    '-fps_mode', 'cfr'
  ]
}

function audioCodecArgs(audio: AudioPlan): string[] {
  if (audio.action === 'copy') return ['-c:a', 'copy']
  return ['-c:a', audio.outputCodec, '-b:a', `${audio.bitrateKbps}k`, '-ac', String(audio.channels)]
}

export interface EncodeProgress {
  outTimeSeconds: number
  percent: number
}

export function parseProgressLine(line: string, durationSeconds: number): EncodeProgress | null {
  const [key, value] = line.split('=', 2)
  if (key !== 'out_time_us' || value === undefined) return null
  const seconds = Number(value) / 1e6
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return { outTimeSeconds: seconds, percent: Math.min(100, (seconds / durationSeconds) * 100) }
}

export async function runFfmpeg(
  binaries: Binaries,
  args: string[],
  durationSeconds: number,
  hooks: { onProgress?: (p: EncodeProgress) => void; onLog?: (line: string) => void; signal?: AbortSignal }
): Promise<void> {
  await run(binaries.ffmpeg, args, {
    signal: hooks.signal,
    onStdoutLine: (line) => {
      const progress = parseProgressLine(line, durationSeconds)
      if (progress) hooks.onProgress?.(progress)
    },
    onStderrLine: hooks.onLog
  })
}

export function buildSubtitleArgs(source: SourceInfo, subtitle: SubtitlePlan, encDir: string): { args: string[]; file: string } {
  const file = join(encDir, encodedSubtitleFile(subtitle.sourceIndex))
  const input = subtitle.input.path ?? source.path
  return {
    args: ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', input, '-map', `0:${subtitle.input.streamIndex}`, '-c:s', 'webvtt', '-f', 'webvtt', file],
    file
  }
}

export interface SubtitleExtraction {
  extracted: SubtitlePlan[]
  files: { sourceIndex: number; file: string }[]
  failed: SkippedItem[]
}

// Text subtitles are cheap: converted one by one before the video encode, and a
// track ffmpeg cannot convert is reported as skipped instead of failing the job.
export async function extractSubtitles(
  binaries: Binaries,
  source: SourceInfo,
  subtitles: SubtitlePlan[],
  encDir: string,
  hooks: { onLog?: (line: string) => void; signal?: AbortSignal }
): Promise<SubtitleExtraction> {
  const result: SubtitleExtraction = { extracted: [], files: [], failed: [] }
  for (const subtitle of subtitles) {
    const { args, file } = buildSubtitleArgs(source, subtitle, encDir)
    hooks.onLog?.(`ffmpeg ${args.join(' ')}`)
    try {
      await run(binaries.ffmpeg, args, { signal: hooks.signal, onStderrLine: hooks.onLog })
      result.extracted.push(subtitle)
      result.files.push({ sourceIndex: subtitle.sourceIndex, file })
    } catch (error) {
      if (hooks.signal?.aborted) throw error
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
      result.failed.push({ kind: 'subtitle', id: String(subtitle.sourceIndex), reason: `no se pudo convertir a WebVTT: ${message}` })
    }
  }
  return result
}
