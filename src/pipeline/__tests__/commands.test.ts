import { describe, expect, it } from 'vitest'
import { buildFfmpegArgs, buildSubtitleArgs, parseProgressLine } from '../ffmpeg'
import { buildPackagerArgs } from '../packager'
import { languageDisplayName, toBcp47 } from '../lang'
import type { EncodePlan, SourceInfo } from '../types'

const source: SourceInfo = {
  path: 'C:/in/movie.mkv',
  sizeBytes: 1,
  durationSeconds: 100,
  containerBitrate: null,
  video: {
    index: 0,
    codec: 'h264',
    width: 1920,
    height: 800,
    displayWidth: 1920,
    displayHeight: 800,
    fps: { num: 24000, den: 1001 },
    bitrate: null,
    bitrateEstimated: true,
    pixelFormat: 'yuv420p'
  },
  audio: [],
  subtitles: []
}

const plan: EncodePlan = {
  fps: { num: 24000, den: 1001 },
  segmentDurationSeconds: 6,
  actualSegmentSeconds: 6.006,
  renditions: [{ label: '720p', width: 1280, height: 534, maxBitrateKbps: 3000, gopFrames: 144 }],
  audio: [
    { sourceIndex: 1, input: { streamIndex: 1 }, action: 'copy', sourceCodec: 'aac', outputCodec: 'aac', channels: 2, bitrateKbps: null, language: 'es', name: 'Español', title: null, isDefault: false },
    { sourceIndex: 2, input: { streamIndex: 2 }, action: 'transcode', sourceCodec: 'dts', outputCodec: 'aac', channels: 6, bitrateKbps: 384, language: 'en', name: 'Director, comments', title: 'Director, comments', isDefault: true }
  ],
  subtitles: [
    { sourceIndex: 3, input: { streamIndex: 3 }, sourceCodec: 'subrip', language: 'es', name: 'Español', title: null, forced: false, isDefault: false },
    { sourceIndex: 4, input: { streamIndex: 4 }, sourceCodec: 'ass', language: 'es', name: 'Forzados', title: 'Forzados', forced: true, isDefault: false }
  ],
  skipped: []
}

const window = (args: string[], flag: string, count = 1): string[] => {
  const i = args.indexOf(flag)
  return i === -1 ? [] : args.slice(i + 1, i + 1 + count)
}

describe('buildFfmpegArgs', () => {
  const { args, outputs } = buildFfmpegArgs(source, plan, 'C:/work/enc', { preset: 'veryfast' })

  it('reads the source once and reports progress on stdout', () => {
    expect(args.filter((a) => a === '-i')).toHaveLength(1)
    expect(args.slice(0, 11)).toEqual(['-hide_banner', '-nostdin', '-y', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1', '-i', 'C:/in/movie.mkv', '-map'])
  })

  it('locks the GOP to the segment length with no scene-cut keyframes and constant frame rate', () => {
    expect(window(args, '-g')).toEqual(['144'])
    expect(window(args, '-keyint_min')).toEqual(['144'])
    expect(window(args, '-sc_threshold')).toEqual(['0'])
    expect(window(args, '-r')).toEqual(['24000/1001'])
    expect(window(args, '-fps_mode')).toEqual(['cfr'])
  })

  it('uses capped CRF with the rung ceiling and scales to square pixels', () => {
    expect(window(args, '-crf')).toEqual(['20'])
    expect(window(args, '-maxrate')).toEqual(['3000k'])
    expect(window(args, '-bufsize')).toEqual(['6000k'])
    expect(window(args, '-preset')).toEqual(['veryfast'])
    expect(window(args, '-vf')).toEqual(['scale=1280:534:flags=bicubic,setsar=1'])
    expect(outputs.video).toEqual([{ label: '720p', file: expect.stringMatching(/video_720p\.mp4$/) }])
  })

  it('copies streamable audio and transcodes the rest to AAC with the planned channels', () => {
    const text = args.join(' ')
    expect(text).toContain('-map 0:1 -c:a copy')
    expect(text).toContain('-map 0:2 -c:a aac -b:a 384k -ac 6')
    expect(outputs.audio.map((a) => a.file)).toEqual([expect.stringMatching(/audio_1\.mp4$/), expect.stringMatching(/audio_2\.mp4$/)])
  })

  it('splits the decoded video once when several renditions are planned', () => {
    const multi: EncodePlan = {
      ...plan,
      renditions: [
        { label: '1080p', width: 1920, height: 800, maxBitrateKbps: 6000, gopFrames: 144 },
        { label: '720p', width: 1280, height: 534, maxBitrateKbps: 3000, gopFrames: 144 }
      ]
    }
    const { args: multiArgs } = buildFfmpegArgs(source, multi, 'enc')
    expect(window(multiArgs, '-filter_complex')).toEqual([
      '[0:0]split=2[s_1080p][s_720p];[s_1080p]scale=1920:800:flags=bicubic,setsar=1[v_1080p];[s_720p]scale=1280:534:flags=bicubic,setsar=1[v_720p]'
    ])
    expect(multiArgs.filter((a) => a === '-vf')).toHaveLength(0)
    expect(multiArgs.filter((a) => a.startsWith('[v_'))).toEqual(['[v_1080p]', '[v_720p]'])
  })
})

describe('buildFfmpegArgs with external tracks', () => {
  it('adds external files as further inputs and maps tracks by input index', () => {
    const external: EncodePlan = {
      ...plan,
      renditions: [],
      audio: [
        plan.audio[0]!,
        { ...plan.audio[1]!, sourceIndex: -1, input: { path: 'C:/in/dub.m4a', streamIndex: 0 }, sourceCodec: 'aac', action: 'copy', outputCodec: 'aac', bitrateKbps: null }
      ]
    }
    const { args, outputs } = buildFfmpegArgs(source, external, 'enc')
    expect(args.filter((a) => a === '-i')).toHaveLength(2)
    expect(args.join(' ')).toContain('-i C:/in/movie.mkv -i C:/in/dub.m4a')
    expect(args.join(' ')).toContain('-map 1:0 -c:a copy')
    expect(outputs.audio.map((a) => a.file)).toEqual([expect.stringMatching(/audio_1\.mp4$/), expect.stringMatching(/audio_e1\.mp4$/)])
  })
})

describe('buildSubtitleArgs', () => {
  it('converts one text track to WebVTT with a standalone ffmpeg run', () => {
    const { args, file } = buildSubtitleArgs(source, plan.subtitles[0]!, 'C:/work/enc')
    expect(file).toMatch(/sub_3\.vtt$/)
    expect(args.join(' ')).toContain('-i C:/in/movie.mkv -map 0:3 -c:s webvtt -f webvtt')
  })
})

describe('parseProgressLine', () => {
  it('converts out_time_us into a percentage of the source duration', () => {
    expect(parseProgressLine('out_time_us=50000000', 100)).toEqual({ outTimeSeconds: 50, percent: 50 })
    expect(parseProgressLine('out_time_us=120000000', 100)?.percent).toBe(100)
    expect(parseProgressLine('frame=12', 100)).toBeNull()
    expect(parseProgressLine('out_time_us=N/A', 100)).toBeNull()
  })
})

describe('buildPackagerArgs', () => {
  const args = buildPackagerArgs(plan, ['hls'])

  it('describes every stream relative to the work dir with the published layout', () => {
    expect(args[0]).toBe(
      'in=enc/video_720p.mp4,stream=video,init_segment=pkg/video/720p/init.mp4,segment_template=pkg/video/720p/seg_$Number%05d$.m4s,playlist_name=video/720p/playlist.m3u8'
    )
    expect(args[1]).toBe(
      'in=enc/audio_1.mp4,stream=audio,init_segment=pkg/audio/1_es_aac/init.mp4,segment_template=pkg/audio/1_es_aac/seg_$Number%05d$.m4s,playlist_name=audio/1_es_aac/playlist.m3u8,hls_group_id=audio,hls_name=Español,language=es'
    )
  })

  it('strips descriptor separators from track names', () => {
    expect(args[2]).toContain('hls_name=Director  comments,language=en')
  })

  it('packages text tracks as raw WebVTT segments, flagging forced ones', () => {
    expect(args[3]).toBe(
      'in=enc/sub_3.vtt,stream=text,segment_template=pkg/subs/3_es/seg_$Number%05d$.vtt,playlist_name=subs/3_es/playlist.m3u8,hls_group_id=subs,hls_name=Español,language=es'
    )
    expect(args[4]).toBe(
      'in=enc/sub_4.vtt,stream=text,segment_template=pkg/subs/4_es/seg_$Number%05d$.vtt,playlist_name=subs/4_es/playlist.m3u8,hls_group_id=subs,hls_name=Forzados,language=es,forced_subtitle=1'
    )
  })

  it('keeps subtitles off by default unless the source flags one', () => {
    expect(window(args, '--default_text_language')).toEqual(['zxx'])
    const flagged: EncodePlan = { ...plan, subtitles: [{ ...plan.subtitles[0]!, isDefault: true }] }
    expect(window(buildPackagerArgs(flagged, ['hls']), '--default_text_language')).toEqual(['es'])
    expect(buildPackagerArgs({ ...plan, subtitles: [] }, ['hls'])).not.toContain('--default_text_language')
  })

  it('passes the exact segment length, default language and only the requested manifests', () => {
    expect(window(args, '--segment_duration')).toEqual(['6.006000'])
    expect(window(args, '--default_language')).toEqual(['en'])
    expect(window(args, '--hls_master_playlist_output')).toEqual(['pkg/master.m3u8'])
    expect(args).not.toContain('--mpd_output')

    const both = buildPackagerArgs(plan, ['hls', 'dash'])
    expect(window(both, '--mpd_output')).toEqual(['pkg/manifest.mpd'])
    expect(both).toContain('--generate_static_live_mpd')
  })
})

describe('language tags', () => {
  it('maps ISO 639-2 (B and T) to the shortest BCP-47 form', () => {
    expect(['spa', 'eng', 'fre', 'fra', 'ger', 'jpn', 'und', 'xyz', 'pt-BR', ''].map(toBcp47)).toEqual([
      'es', 'en', 'fr', 'fr', 'de', 'ja', 'und', 'xyz', 'pt-br', 'und'
    ])
    expect(toBcp47(null)).toBe('und')
  })

  it('names languages in their own language', () => {
    expect(languageDisplayName('es')).toBe('Español')
    expect(languageDisplayName('en')).toBe('English')
    expect(languageDisplayName('und')).toBe('Desconocido')
  })
})
