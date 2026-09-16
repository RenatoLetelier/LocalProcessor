import { join } from 'node:path'
import { run } from './exec'
import { encodedAudioFile, encodedVideoFile } from './layout'
import type { AudioPlan, Binaries, EncodePlan, RenditionPlan, SourceInfo, VideoEncoderOptions } from './types'

export const DEFAULT_VIDEO_ENCODER: Required<VideoEncoderOptions> = { preset: 'medium', crf: 20 }

export interface EncodeOutputs {
  video: { label: string; file: string }[]
  audio: { sourceIndex: number; file: string }[]
}

// One ffmpeg invocation decodes the source once and writes every rendition and
// audio track as separate MP4 intermediates for the packager.
export function buildFfmpegArgs(
  source: SourceInfo,
  plan: EncodePlan,
  encDir: string,
  encoder: VideoEncoderOptions = {}
): { args: string[]; outputs: EncodeOutputs } {
  const opts = { ...DEFAULT_VIDEO_ENCODER, ...encoder }
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1', '-i', source.path]
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
    args.push('-map', `0:${audio.sourceIndex}`, ...audioCodecArgs(audio), '-vn', '-sn', '-dn', '-map_metadata', '-1', '-f', 'mp4', file)
    outputs.audio.push({ sourceIndex: audio.sourceIndex, file })
  }

  return { args, outputs }
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
