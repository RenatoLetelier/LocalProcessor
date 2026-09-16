import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/config'
import { aacBitrateKbps, fitInBox, gopFrames, planAudio, planEncode, wouldUpscale } from '../plan'
import type { SourceAudio, SourceInfo } from '../types'

const audio = (over: Partial<SourceAudio>): SourceAudio => ({
  index: 1,
  codec: 'aac',
  channels: 2,
  channelLayout: 'stereo',
  sampleRate: 48000,
  bitrate: 128000,
  language: 'spa',
  title: null,
  isDefault: false,
  ...over
})

const source = (over: Partial<SourceInfo['video']> = {}, extra: Partial<SourceInfo> = {}): SourceInfo => ({
  path: 'movie.mkv',
  sizeBytes: 1e9,
  durationSeconds: 5400,
  containerBitrate: null,
  video: {
    index: 0,
    codec: 'h264',
    width: 1920,
    height: 800,
    displayWidth: 1920,
    displayHeight: 800,
    fps: { num: 24000, den: 1001 },
    bitrate: 8_000_000,
    bitrateEstimated: false,
    pixelFormat: 'yuv420p',
    ...over
  },
  audio: [audio({})],
  subtitles: [],
  ...extra
})

const options = { rungs: DEFAULT_CONFIG.rungs, qualities: DEFAULT_CONFIG.qualities, segmentDurationSeconds: 6 }

describe('gopFrames', () => {
  it('snaps segment duration × fps to whole frames', () => {
    expect(gopFrames(6, { num: 24000, den: 1001 })).toBe(144)
    expect(gopFrames(6, { num: 25, den: 1 })).toBe(150)
    expect(gopFrames(2, { num: 30000, den: 1001 })).toBe(60)
    expect(gopFrames(4, { num: 24, den: 1 })).toBe(96)
  })
})

describe('fitInBox / wouldUpscale', () => {
  const box = (label: string) => DEFAULT_CONFIG.rungs[label]!

  it('keeps the aspect ratio of scope movies inside each box', () => {
    expect(fitInBox(1920, 800, box('1080p'))).toEqual({ width: 1920, height: 800 })
    expect(fitInBox(1920, 800, box('720p'))).toEqual({ width: 1280, height: 534 })
    expect(fitInBox(1920, 800, box('480p'))).toEqual({ width: 854, height: 356 })
  })

  it('handles 4:3 and 16:10 sources by whichever edge hits the box first', () => {
    expect(fitInBox(1440, 1080, box('1080p'))).toEqual({ width: 1440, height: 1080 })
    expect(fitInBox(1440, 1080, box('720p'))).toEqual({ width: 960, height: 720 })
    expect(fitInBox(1920, 1200, box('1080p'))).toEqual({ width: 1728, height: 1080 })
  })

  it('never scales up', () => {
    expect(fitInBox(1280, 720, box('2160p'))).toEqual({ width: 1280, height: 720 })
    expect(wouldUpscale(1600, 900, box('1080p'))).toBe(true)
    expect(wouldUpscale(1920, 800, box('1080p'))).toBe(false)
    expect(wouldUpscale(1440, 1080, box('1080p'))).toBe(false)
    expect(wouldUpscale(1920, 1080, box('1080p'))).toBe(false)
  })
})

describe('planEncode', () => {
  it('drops rungs that would upscale and keeps the configured order', () => {
    const plan = planEncode(source(), options)
    expect(plan.renditions.map((r) => r.label)).toEqual(['1080p', '720p', '480p'])
    expect(plan.skipped).toContainEqual({ kind: 'rendition', id: '2160p', reason: expect.stringContaining('upscaling') })
  })

  it('caps each rung at the source bitrate', () => {
    const plan = planEncode(source({ bitrate: 2_500_000 }), options)
    expect(plan.renditions.map((r) => [r.label, r.maxBitrateKbps])).toEqual([
      ['1080p', 2500],
      ['720p', 2500],
      ['480p', 1500]
    ])
  })

  it('uses the rung ceiling when the source bitrate is unknown', () => {
    const plan = planEncode(source({ bitrate: null }), { ...options, qualities: ['720p'] })
    expect(plan.renditions[0]?.maxBitrateKbps).toBe(3000)
  })

  it('derives GOP and the exact segment length from the frame rate', () => {
    const plan = planEncode(source(), options)
    expect(plan.renditions[0]?.gopFrames).toBe(144)
    expect(plan.actualSegmentSeconds).toBeCloseTo(6.006, 3)
  })

  it('skips unknown labels and reports subtitles as pending', () => {
    const plan = planEncode(
      source({}, { subtitles: [{ index: 3, codec: 'subrip', language: 'spa', title: null, isForced: false, isImage: false }] }),
      { ...options, qualities: ['900p', '720p'] }
    )
    expect(plan.renditions.map((r) => r.label)).toEqual(['720p'])
    expect(plan.skipped.map((s) => s.kind)).toEqual(['rendition', 'subtitle'])
  })
})

describe('planAudio', () => {
  it('copies streamable codecs untouched', () => {
    expect(planAudio(audio({ codec: 'eac3', channels: 6, language: 'eng', isDefault: true }))).toEqual({
      sourceIndex: 1,
      action: 'copy',
      outputCodec: 'eac3',
      channels: 6,
      bitrateKbps: null,
      language: 'en',
      name: 'English',
      isDefault: true
    })
  })

  it('transcodes everything else to AAC keeping the channel count', () => {
    expect(planAudio(audio({ codec: 'dts', channels: 6, language: 'spa', title: 'Latino' }))).toMatchObject({
      action: 'transcode',
      outputCodec: 'aac',
      channels: 6,
      bitrateKbps: 384,
      language: 'es',
      name: 'Latino'
    })
    expect(planAudio(audio({ codec: 'truehd', channels: 8 })).channels).toBe(8)
    expect(planAudio(audio({ codec: 'flac', channels: 1 })).bitrateKbps).toBe(128)
  })

  it('names untagged tracks as undetermined', () => {
    expect(planAudio(audio({ language: null }))).toMatchObject({ language: 'und', name: 'Desconocido' })
  })

  it('scales AAC bitrate with channels inside 128–512 kbps', () => {
    expect([1, 2, 6, 8].map(aacBitrateKbps)).toEqual([128, 128, 384, 512])
  })
})
