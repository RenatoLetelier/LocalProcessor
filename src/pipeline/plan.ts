import type { Rung } from '@shared/config'
import { languageDisplayName, toBcp47 } from './lang'
import { toEven, type TrackFileInfo } from './probe'
import type {
  AudioPlan,
  EncodePlan,
  ExternalTrack,
  Fraction,
  PlanOptions,
  RenditionPlan,
  SkippedItem,
  SourceAudio,
  SourceInfo,
  SourceSubtitle,
  SubtitlePlan,
  TrackInput
} from './types'

// Audio codecs HLS/DASH accept as-is inside fMP4. Dolby tracks are copied for the
// players that decode them (Safari, Edge, TVs) and also get an AAC companion, since
// Chrome and Firefox cannot play AC-3/E-AC-3 at all.
export const STREAMABLE_AUDIO_CODECS = new Set(['aac', 'ac3', 'eac3'])
export const TRANSCODE_AUDIO_CODEC = 'aac'
const MAX_AAC_CHANNELS = 8

// Subtitle codecs ffmpeg can turn into WebVTT
export const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'])

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

  // Every enabled rung would upscale: serve the source at its own size rather than reject it
  const enabled = options.qualities.filter((label) => label in options.rungs)
  if (renditions.length === 0 && enabled.length > 0 && options.allowNativeFallback !== false) {
    renditions.push(nativeRendition(source, options, enabled, gop))
  }

  const wanted = (indexes: number[] | undefined, index: number): boolean => indexes === undefined || indexes.includes(index)
  const audio = source.audio.filter((track) => wanted(options.audioIndexes, track.index)).flatMap((track) => planAudioTracks(track))
  const subtitles: SubtitlePlan[] = []
  for (const subtitle of source.subtitles) {
    if (!wanted(options.subtitleIndexes, subtitle.index)) continue
    const planned = planSubtitle(subtitle)
    if ('reason' in planned) skipped.push(planned)
    else subtitles.push(planned)
  }

  return {
    fps,
    segmentDurationSeconds: options.segmentDurationSeconds,
    actualSegmentSeconds: (gop * fps.den) / fps.num,
    renditions,
    audio,
    subtitles,
    skipped
  }
}

// Image subtitles (PGS, VobSub, DVB) would need OCR: they are reported, never silently dropped
export function planSubtitle(subtitle: SourceSubtitle, input?: TrackInput, sourceIndex = subtitle.index): SubtitlePlan | SkippedItem {
  const id = String(sourceIndex)
  if (subtitle.isImage) {
    return { kind: 'subtitle', id, reason: `subtítulo de imagen (${subtitle.codec}): requiere OCR, no incluido` }
  }
  if (!TEXT_SUBTITLE_CODECS.has(subtitle.codec)) {
    return { kind: 'subtitle', id, reason: `formato de subtítulo no soportado (${subtitle.codec})` }
  }
  const language = toBcp47(subtitle.language)
  return {
    sourceIndex,
    input: input ?? { streamIndex: subtitle.index },
    sourceCodec: subtitle.codec,
    language,
    name: subtitle.title ?? languageDisplayName(language),
    title: subtitle.title,
    forced: subtitle.isForced,
    isDefault: subtitle.isDefault
  }
}

// Labelled by height like a normal rung; the ceiling is the smallest enabled rung's
function nativeRendition(source: SourceInfo, options: PlanOptions, enabled: string[], gop: number): RenditionPlan {
  const { displayWidth, displayHeight } = source.video
  const smallestCeiling = Math.min(...enabled.map((label) => options.rungs[label]!.maxBitrateKbps))
  const sourceKbps = source.video.bitrate ? Math.floor(source.video.bitrate / 1000) : null
  const base = `${displayHeight}p`
  return {
    label: enabled.includes(base) ? `${base}-native` : base,
    width: toEven(displayWidth),
    height: toEven(displayHeight),
    maxBitrateKbps: sourceKbps ? Math.min(smallestCeiling, sourceKbps) : smallestCeiling,
    gopFrames: gop,
    nativeFallback: true
  }
}

export function planAudio(track: SourceAudio, input?: TrackInput, sourceIndex = track.index): AudioPlan {
  const language = toBcp47(track.language)
  const name = track.title ?? languageDisplayName(language)
  const copy = STREAMABLE_AUDIO_CODECS.has(track.codec)
  const channels = copy ? track.channels : Math.min(track.channels, MAX_AAC_CHANNELS)

  return {
    sourceIndex,
    input: input ?? { streamIndex: track.index },
    action: copy ? 'copy' : 'transcode',
    sourceCodec: track.codec,
    outputCodec: copy ? track.codec : TRANSCODE_AUDIO_CODEC,
    channels,
    bitrateKbps: copy ? null : aacBitrateKbps(channels),
    language,
    name,
    title: track.title,
    isDefault: track.isDefault
  }
}

// Everything a source track publishes: the track itself plus, for copied Dolby
// audio, an AAC companion with the same channels, name and language
export function planAudioTracks(track: SourceAudio, input?: TrackInput, sourceIndex = track.index): AudioPlan[] {
  const primary = planAudio(track, input, sourceIndex)
  const companion = aacCompanion(primary)
  return companion ? [primary, companion] : [primary]
}

export function aacCompanion(audio: AudioPlan): AudioPlan | null {
  if (audio.action !== 'copy' || audio.outputCodec === TRANSCODE_AUDIO_CODEC) return null
  const channels = Math.min(audio.channels, MAX_AAC_CHANNELS)
  return { ...audio, action: 'transcode', outputCodec: TRANSCODE_AUDIO_CODEC, channels, bitrateKbps: aacBitrateKbps(channels) }
}

// 64 kbps per channel, bounded: 128k stereo, 384k 5.1, 512k 7.1
export function aacBitrateKbps(channels: number): number {
  return Math.min(512, Math.max(128, 64 * channels))
}

// An external file contributes its first stream of the requested kind; language and
// name given by the user win over whatever the file declares.
export function planExternalTrack(track: ExternalTrack, info: TrackFileInfo | null): AudioPlan[] | SubtitlePlan | SkippedItem {
  const id = String(track.sourceIndex)
  const input: TrackInput = { path: track.path, streamIndex: 0 }

  if (track.kind === 'audio') {
    const stream = info?.audio[0]
    if (!stream) return { kind: 'audio', id, reason: `el archivo no contiene audio: ${track.path}` }
    return planAudioTracks(
      { ...stream, language: track.language ?? stream.language, title: track.name ?? stream.title, isDefault: false },
      { ...input, streamIndex: stream.index },
      track.sourceIndex
    )
  }

  const stream = info?.subtitles[0]
  if (!stream) return { kind: 'subtitle', id, reason: `el archivo no contiene subtítulos: ${track.path}` }
  return planSubtitle(
    {
      ...stream,
      language: track.language ?? stream.language,
      title: track.name ?? stream.title,
      isForced: track.forced ?? stream.isForced,
      isDefault: false
    },
    { ...input, streamIndex: stream.index },
    track.sourceIndex
  )
}
