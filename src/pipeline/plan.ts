import type { Rung } from '@shared/config'
import { languageDisplayName, toBcp47 } from './lang'
import { toEven } from './probe'
import type { AudioPlan, EncodePlan, Fraction, PlanOptions, RenditionPlan, SkippedItem, SourceAudio, SourceInfo } from './types'

// Audio codecs browsers and HLS/DASH accept as-is inside fMP4
export const STREAMABLE_AUDIO_CODECS = new Set(['aac', 'ac3', 'eac3'])
export const TRANSCODE_AUDIO_CODEC = 'aac'
const MAX_AAC_CHANNELS = 8

export function gopFrames(segmentDurationSeconds: number, fps: Fraction): number {
  return Math.max(1, Math.round((segmentDurationSeconds * fps.num) / fps.den))
}

// Scales (never up) to fit inside the rung box keeping the aspect ratio; even dimensions for yuv420p
export function fitInBox(width: number, height: number, box: Pick<Rung, 'width' | 'height'>): { width: number; height: number } {
  const scale = Math.min(1, box.width / width, box.height / height)
  return { width: toEven(Math.round(width * scale)), height: toEven(Math.round(height * scale)) }
}

// A rung is upscaling when the source is smaller than the box in both dimensions
export function wouldUpscale(width: number, height: number, box: Pick<Rung, 'width' | 'height'>): boolean {
  return width < box.width && height < box.height
}

export function planEncode(source: SourceInfo, options: PlanOptions): EncodePlan {
  const { fps, displayWidth, displayHeight } = source.video
  const gop = gopFrames(options.segmentDurationSeconds, fps)
  const skipped: SkippedItem[] = []
  const renditions: RenditionPlan[] = []

  for (const label of options.qualities) {
    const rung = options.rungs[label]
    if (!rung) {
      skipped.push({ kind: 'rendition', id: label, reason: 'calidad no definida en la configuración' })
      continue
    }
    if (wouldUpscale(displayWidth, displayHeight, rung)) {
      skipped.push({
        kind: 'rendition',
        id: label,
        reason: `el origen (${displayWidth}×${displayHeight}) es menor que ${rung.width}×${rung.height}: sería upscaling`
      })
      continue
    }
    const fit = fitInBox(displayWidth, displayHeight, rung)
    const sourceKbps = source.video.bitrate ? Math.floor(source.video.bitrate / 1000) : null
    renditions.push({
      label,
      width: fit.width,
      height: fit.height,
      // Rule 1: never above the source bitrate either
      maxBitrateKbps: sourceKbps ? Math.min(rung.maxBitrateKbps, sourceKbps) : rung.maxBitrateKbps,
      gopFrames: gop
    })
  }

  const audio = source.audio.map(planAudio)
  for (const subtitle of source.subtitles) {
    skipped.push({ kind: 'subtitle', id: String(subtitle.index), reason: 'subtítulos: pendiente (fase 8)' })
  }

  return {
    fps,
    segmentDurationSeconds: options.segmentDurationSeconds,
    actualSegmentSeconds: (gop * fps.den) / fps.num,
    renditions,
    audio,
    skipped
  }
}

export function planAudio(track: SourceAudio): AudioPlan {
  const language = toBcp47(track.language)
  const name = track.title ?? languageDisplayName(language)
  const copy = STREAMABLE_AUDIO_CODECS.has(track.codec)
  const channels = copy ? track.channels : Math.min(track.channels, MAX_AAC_CHANNELS)

  return {
    sourceIndex: track.index,
    action: copy ? 'copy' : 'transcode',
    outputCodec: copy ? track.codec : TRANSCODE_AUDIO_CODEC,
    channels,
    bitrateKbps: copy ? null : aacBitrateKbps(channels),
    language,
    name,
    isDefault: track.isDefault
  }
}

// 64 kbps per channel, bounded: 128k stereo, 384k 5.1, 512k 7.1
export function aacBitrateKbps(channels: number): number {
  return Math.min(512, Math.max(128, 64 * channels))
}
