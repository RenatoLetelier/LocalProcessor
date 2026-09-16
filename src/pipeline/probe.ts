import { capture } from './exec'
import type { Binaries, Fraction, SourceAudio, SourceInfo, SourceSubtitle, SourceVideo } from './types'

const IMAGE_SUBTITLE_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'])

export class ProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProbeError'
  }
}

export interface FfprobeStream {
  index: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  sample_aspect_ratio?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  bit_rate?: string
  pix_fmt?: string
  channels?: number
  channel_layout?: string
  sample_rate?: string
  duration?: string
  disposition?: Record<string, number>
  tags?: Record<string, string>
}

export interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string; size?: string; bit_rate?: string }
}

export async function probeSource(binaries: Binaries, path: string, signal?: AbortSignal): Promise<SourceInfo> {
  return parseProbeOutput(await runProbe(binaries, path, signal), path)
}

// Audio dubs and subtitle files have no video: only their tracks matter
export interface TrackFileInfo {
  path: string
  audio: SourceAudio[]
  subtitles: SourceSubtitle[]
}

export async function probeTrackFile(binaries: Binaries, path: string, signal?: AbortSignal): Promise<TrackFileInfo> {
  const streams = (await runProbe(binaries, path, signal)).streams ?? []
  return {
    path,
    audio: streams.filter((s) => s.codec_type === 'audio').map(parseAudio),
    subtitles: streams.filter((s) => s.codec_type === 'subtitle').map(parseSubtitle)
  }
}

async function runProbe(binaries: Binaries, path: string, signal?: AbortSignal): Promise<FfprobeOutput> {
  const json = await capture(
    binaries.ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { signal }
  )
  return JSON.parse(json) as FfprobeOutput
}

export function parseProbeOutput(output: FfprobeOutput, path: string): SourceInfo {
  const streams = output.streams ?? []
  const format = output.format ?? {}

  // Cover art in MKV/MP4 is exposed as a video stream flagged attached_pic
  const videoStream = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  if (!videoStream) throw new ProbeError('El archivo no contiene una pista de video')

  // The container duration spans every stream (a late subtitle cue makes it longer
  // than the picture), so the video stream's own duration wins when it is known
  const durationSeconds =
    toNumber(videoStream.duration) ?? parseTimecode(videoStream.tags?.DURATION) ?? toNumber(format.duration)
  if (!durationSeconds || durationSeconds <= 0) throw new ProbeError('No se pudo determinar la duración del archivo')

  const audio = streams.filter((s) => s.codec_type === 'audio').map(parseAudio)
  const subtitles = streams.filter((s) => s.codec_type === 'subtitle').map(parseSubtitle)
  const containerBitrate = toInt(format.bit_rate)
  const sizeBytes = toInt(format.size) ?? 0

  return {
    path,
    sizeBytes,
    durationSeconds,
    containerBitrate,
    video: parseVideo(videoStream, { containerBitrate, sizeBytes, durationSeconds, audio }),
    audio,
    subtitles
  }
}

interface BitrateContext {
  containerBitrate: number | null
  sizeBytes: number
  durationSeconds: number
  audio: SourceAudio[]
}

function parseVideo(stream: FfprobeStream, ctx: BitrateContext): SourceVideo {
  const width = stream.width ?? 0
  const height = stream.height ?? 0
  if (width <= 0 || height <= 0) throw new ProbeError('La pista de video no informa resolución')

  const sar = parseFraction(stream.sample_aspect_ratio) ?? { num: 1, den: 1 }
  const displayWidth = sar.num > 0 && sar.den > 0 ? toEven(Math.round((width * sar.num) / sar.den)) : width

  const declared = toInt(stream.bit_rate) ?? toInt(stream.tags?.BPS) ?? toInt(stream.tags?.['BPS-eng'])
  const estimated = declared ?? estimateVideoBitrate(ctx)

  return {
    index: stream.index,
    codec: stream.codec_name ?? 'unknown',
    width,
    height,
    displayWidth,
    displayHeight: height,
    fps: pickFrameRate(stream),
    bitrate: estimated,
    bitrateEstimated: declared === null,
    pixelFormat: stream.pix_fmt ?? null
  }
}

// MKV rarely carries per-stream bitrates: fall back to container bitrate minus the audio we know about
function estimateVideoBitrate(ctx: BitrateContext): number | null {
  const total = ctx.containerBitrate ?? (ctx.sizeBytes > 0 ? Math.round((ctx.sizeBytes * 8) / ctx.durationSeconds) : null)
  if (total === null) return null
  const audioTotal = ctx.audio.reduce((sum, a) => sum + (a.bitrate ?? 0), 0)
  return Math.max(total - audioTotal, Math.round(total * 0.5))
}

function pickFrameRate(stream: FfprobeStream): Fraction {
  const real = parseFraction(stream.r_frame_rate)
  const average = parseFraction(stream.avg_frame_rate)
  const valid = (f: Fraction | null): f is Fraction => !!f && f.num > 0 && f.den > 0
  const value = (f: Fraction): number => f.num / f.den

  // r_frame_rate is the timebase-derived rate and can be absurd for VFR sources
  if (valid(real) && value(real) <= 120 && (!valid(average) || value(real) <= value(average) * 1.5)) return real
  if (valid(average)) return average
  if (valid(real)) return real
  throw new ProbeError('La pista de video no informa frame rate')
}

function parseAudio(stream: FfprobeStream): SourceAudio {
  return {
    index: stream.index,
    codec: stream.codec_name ?? 'unknown',
    channels: stream.channels ?? 2,
    channelLayout: stream.channel_layout ?? null,
    sampleRate: toInt(stream.sample_rate),
    bitrate: toInt(stream.bit_rate) ?? toInt(stream.tags?.BPS) ?? toInt(stream.tags?.['BPS-eng']),
    language: normalizeTag(stream.tags?.language),
    title: normalizeTag(stream.tags?.title),
    isDefault: stream.disposition?.default === 1
  }
}

function parseSubtitle(stream: FfprobeStream): SourceSubtitle {
  const codec = stream.codec_name ?? 'unknown'
  return {
    index: stream.index,
    codec,
    language: normalizeTag(stream.tags?.language),
    title: normalizeTag(stream.tags?.title),
    isForced: stream.disposition?.forced === 1,
    isDefault: stream.disposition?.default === 1,
    isImage: IMAGE_SUBTITLE_CODECS.has(codec)
  }
}

export function parseFraction(text: string | undefined): Fraction | null {
  if (!text) return null
  const [num, den = '1'] = text.split(/[/:]/)
  const n = Number(num)
  const d = Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d)) return null
  return { num: n, den: d }
}

// Matroska DURATION tags look like 01:52:03.456000000
export function parseTimecode(text: string | undefined): number | null {
  const match = text?.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function normalizeTag(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed !== 'und' ? trimmed : null
}

function toNumber(value: string | undefined): number | null {
  const n = Number(value)
  return value !== undefined && Number.isFinite(n) ? n : null
}

function toInt(value: string | undefined): number | null {
  const n = toNumber(value)
  return n === null ? null : Math.round(n)
}

export function toEven(n: number): number {
  return n % 2 === 0 ? n : n + 1
}
