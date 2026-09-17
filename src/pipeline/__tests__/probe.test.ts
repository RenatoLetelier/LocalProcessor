import { describe, expect, it } from 'vitest'
import { DEFAULT_HDR_PEAK_NITS, parseFraction, parseHdrPeak, parseProbeOutput, parseTimecode, type FfprobeOutput, type FfprobeStream } from '../probe'

// Trimmed ffprobe -show_format -show_streams output of a typical MKV rip
const mkv: FfprobeOutput = {
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 900, disposition: { attached_pic: 1 } },
    {
      index: 1,
      codec_type: 'video',
      codec_name: 'h264',
      width: 720,
      height: 576,
      sample_aspect_ratio: '64:45',
      r_frame_rate: '25/1',
      avg_frame_rate: '25/1',
      pix_fmt: 'yuv420p',
      tags: { BPS: '4500000' }
    },
    {
      index: 2,
      codec_type: 'audio',
      codec_name: 'aac',
      channels: 2,
      channel_layout: 'stereo',
      sample_rate: '48000',
      bit_rate: '128000',
      disposition: { default: 1 },
      tags: { language: 'spa', title: 'Latino' }
    },
    {
      index: 3,
      codec_type: 'audio',
      codec_name: 'dts',
      channels: 6,
      channel_layout: '5.1(side)',
      sample_rate: '48000',
      tags: { language: 'eng', 'BPS-eng': '1536000' }
    },
    { index: 4, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'spa' }, disposition: { forced: 1 } },
    { index: 5, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'und' }, disposition: { default: 1 } }
  ],
  format: { format_name: 'matroska,webm', duration: '5400.123', size: '4000000000', bit_rate: '5925000' }
}

describe('parseProbeOutput', () => {
  const info = parseProbeOutput(mkv, 'C:/in/movie.mkv')

  it('skips cover art and keeps the real video stream', () => {
    expect(info.video.index).toBe(1)
    expect(info.video.codec).toBe('h264')
  })

  it('derives square-pixel display dimensions from the sample aspect ratio', () => {
    expect(info.video.width).toBe(720)
    expect(info.video.displayWidth).toBe(1024)
    expect(info.video.displayHeight).toBe(576)
  })

  it('reads bitrate from mkvmerge statistics tags', () => {
    expect(info.video.bitrate).toBe(4500000)
    expect(info.video.bitrateEstimated).toBe(false)
    expect(info.audio[1]?.bitrate).toBe(1536000)
  })

  it('keeps frame rate as an exact fraction', () => {
    expect(info.video.fps).toEqual({ num: 25, den: 1 })
    expect(parseFraction('24000/1001')).toEqual({ num: 24000, den: 1001 })
  })

  it('lists every audio track with language, title and default flag', () => {
    expect(info.audio).toHaveLength(2)
    expect(info.audio[0]).toMatchObject({ index: 2, codec: 'aac', channels: 2, language: 'spa', title: 'Latino', isDefault: true })
    expect(info.audio[1]).toMatchObject({ index: 3, codec: 'dts', channels: 6, language: 'eng', title: null, isDefault: false })
  })

  it('flags image subtitles and forced tracks, normalising "und" to null', () => {
    expect(info.subtitles[0]).toMatchObject({ index: 4, codec: 'hdmv_pgs_subtitle', isImage: true, isForced: true, language: 'spa', isDefault: false })
    expect(info.subtitles[1]).toMatchObject({ index: 5, codec: 'subrip', isImage: false, isForced: false, language: null, isDefault: true })
  })

  it('ignores the subtitle default flag in MP4, where it is only the track "enabled" bit', () => {
    const mp4 = structuredClone(mkv)
    mp4.format!.format_name = 'mov,mp4,m4a,3gp,3g2,mj2'
    mp4.streams![5]!.codec_name = 'mov_text'
    const parsed = parseProbeOutput(mp4, 'x.mp4')
    expect(parsed.subtitles[1]).toMatchObject({ codec: 'mov_text', isDefault: false })
    expect(parsed.audio[0]?.isDefault).toBe(true)
  })

  it('takes duration and size from the container when the video stream has none', () => {
    expect(info.durationSeconds).toBeCloseTo(5400.123)
    expect(info.sizeBytes).toBe(4000000000)
    expect(info.containerBitrate).toBe(5925000)
  })

  it('prefers the video stream duration over the container duration', () => {
    const withTag = structuredClone(mkv)
    withTag.streams![1]!.tags = { ...withTag.streams![1]!.tags, DURATION: '01:29:59.500000000' }
    expect(parseProbeOutput(withTag, 'x.mkv').durationSeconds).toBeCloseTo(5399.5)

    const withField = structuredClone(mkv)
    withField.streams![1]!.duration = '5398.25'
    expect(parseProbeOutput(withField, 'x.mkv').durationSeconds).toBeCloseTo(5398.25)
    expect(parseTimecode('00:00:20.020000000')).toBeCloseTo(20.02)
    expect(parseTimecode('garbage')).toBeNull()
  })

  it('estimates the video bitrate from the container when no stream value exists', () => {
    const noBps = structuredClone(mkv)
    delete noBps.streams![1]!.tags
    const estimated = parseProbeOutput(noBps, 'x.mkv')
    expect(estimated.video.bitrateEstimated).toBe(true)
    expect(estimated.video.bitrate).toBe(5925000 - 128000 - 1536000)
  })

  it('prefers avg_frame_rate when r_frame_rate is an absurd VFR timebase', () => {
    const vfr = structuredClone(mkv)
    vfr.streams![1]!.r_frame_rate = '1000/1'
    vfr.streams![1]!.avg_frame_rate = '24000/1001'
    expect(parseProbeOutput(vfr, 'x.mkv').video.fps).toEqual({ num: 24000, den: 1001 })
  })

  it('rejects files without a video stream or duration', () => {
    expect(() => parseProbeOutput({ streams: [mkv.streams![2]!], format: mkv.format }, 'x')).toThrow(/pista de video/)
    expect(() => parseProbeOutput({ streams: [mkv.streams![1]!], format: {} }, 'x')).toThrow(/duración/)
  })
})

describe('HDR detection', () => {
  const hdrStream: FfprobeStream = {
    index: 0,
    codec_type: 'video',
    codec_name: 'hevc',
    width: 3840,
    height: 2160,
    r_frame_rate: '24000/1001',
    pix_fmt: 'yuv420p10le',
    color_transfer: 'smpte2084',
    color_primaries: 'bt2020',
    color_space: 'bt2020nc',
    side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 8 }]
  }
  const probe = (over: Partial<FfprobeStream>) => parseProbeOutput({ streams: [{ ...hdrStream, ...over }], format: { duration: '100' } }, 'x.mkv')

  it('recognises PQ and HLG transfers, carrying the colour signalling and the Dolby Vision profile', () => {
    expect(probe({}).video.hdr).toEqual({
      transfer: 'pq',
      colorTransfer: 'smpte2084',
      colorPrimaries: 'bt2020',
      colorSpace: 'bt2020nc',
      peakNits: DEFAULT_HDR_PEAK_NITS,
      dolbyVisionProfile: 8
    })
    expect(probe({ color_transfer: 'arib-std-b67', side_data_list: [] }).video.hdr).toMatchObject({ transfer: 'hlg', dolbyVisionProfile: null })
  })

  it('assumes BT.2020 when an HDR stream omits primaries or matrix', () => {
    expect(probe({ color_primaries: undefined, color_space: undefined }).video.hdr).toMatchObject({ colorPrimaries: 'bt2020', colorSpace: 'bt2020nc' })
  })

  it('treats anything else, tagged or untagged, as SDR', () => {
    expect(probe({ color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709' }).video.hdr).toBeNull()
    expect(probe({ color_transfer: undefined }).video.hdr).toBeNull()
    expect(parseProbeOutput(mkv, 'x').video.hdr).toBeNull()
  })

  it('takes the peak from MaxCLL, then the mastering display, then the default', () => {
    const mastering = { side_data_type: 'Mastering display metadata', max_luminance: '10000000/10000' }
    const light = { side_data_type: 'Content light level metadata', max_content: 449 }
    expect(parseHdrPeak({ frames: [{ side_data_list: [mastering, light] }] })).toBe(449)
    expect(parseHdrPeak({ frames: [{ side_data_list: [mastering] }] })).toBe(1000)
    expect(parseHdrPeak({ frames: [{ side_data_list: [{ ...light, max_content: 0 }, { ...mastering, max_luminance: '4000000/10000' }] }] })).toBe(400)
    expect(parseHdrPeak({ frames: [{}] })).toBe(DEFAULT_HDR_PEAK_NITS)
    expect(parseHdrPeak({})).toBe(DEFAULT_HDR_PEAK_NITS)
  })
})
