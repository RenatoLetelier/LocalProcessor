import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { measureBandwidth, mergeMasterPlaylists, mergeMetadata, mergeMpds, parseMaster, type StreamBandwidth } from '../manifests'
import type { TitleMetadata } from '../types'

const existingMaster = `#EXTM3U
## Generated with shaka-packager

#EXT-X-INDEPENDENT-SEGMENTS

#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/1_es_aac/playlist.m3u8",GROUP-ID="audio-aac",LANGUAGE="es",NAME="Español",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2"
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs/4_es/playlist.m3u8",GROUP-ID="subs",LANGUAGE="es",NAME="Español",DEFAULT=NO,AUTOSELECT=YES

#EXT-X-STREAM-INF:BANDWIDTH=1900000,AVERAGE-BANDWIDTH=1796000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x534,FRAME-RATE=23.976,AUDIO="audio-aac",SUBTITLES="subs",CLOSED-CAPTIONS=NONE
video/720p/playlist.m3u8
`

// What the segments on disk would measure as, per playlist
const bandwidths: Record<string, StreamBandwidth> = {
  'video/720p/playlist.m3u8': { peak: 1800000, average: 1700000 },
  'video/480p/playlist.m3u8': { peak: 700000, average: 650000 },
  'audio/1_es_aac/playlist.m3u8': { peak: 100000, average: 96000 },
  'audio/e1_it_aac/playlist.m3u8': { peak: 130000, average: 128000 },
  'audio/e1_it_eac3/playlist.m3u8': { peak: 400000, average: 390000 }
}
const bandwidthOf = async (uri: string): Promise<StreamBandwidth> => {
  const value = bandwidths[uri]
  if (!value) throw new Error(`sin medición para ${uri}`)
  return value
}
const attribute = (variant: { attributes: { key: string; value: string }[] }, key: string): string | undefined =>
  variant.attributes.find((a) => a.key === key)?.value

describe('mergeMasterPlaylists', () => {
  it('adds a video-only run as a new variant of every audio group, with its bandwidth measured', async () => {
    const addition = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=700000,AVERAGE-BANDWIDTH=650000,CODECS="avc1.64001e",RESOLUTION=854x356,FRAME-RATE=23.976,CLOSED-CAPTIONS=NONE
video/480p/playlist.m3u8
`
    const merged = parseMaster(await mergeMasterPlaylists(existingMaster, addition, bandwidthOf))
    expect(merged.variants.map((v) => v.uri)).toEqual(['video/720p/playlist.m3u8', 'video/480p/playlist.m3u8'])
    const added = merged.variants[1]!
    expect(attribute(added, 'CODECS')).toBe('avc1.64001e,mp4a.40.2')
    expect(attribute(added, 'AUDIO')).toBe('audio-aac')
    expect(attribute(added, 'SUBTITLES')).toBe('subs')
    expect(attribute(added, 'RESOLUTION')).toBe('854x356')
    expect(attribute(added, 'BANDWIDTH')).toBe('800000')
    expect(attribute(added, 'AVERAGE-BANDWIDTH')).toBe('746000')
    expect(merged.media).toHaveLength(2)
    expect(merged.header).toEqual(['#EXTM3U', '## Generated with shaka-packager', '#EXT-X-INDEPENDENT-SEGMENTS'])
  })

  it('multiplies the renditions by the audio groups and keeps one default per group', async () => {
    const addition = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/e1_it_aac/playlist.m3u8",GROUP-ID="audio-aac",LANGUAGE="it",NAME="Italiano",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="6"
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/e1_it_eac3/playlist.m3u8",GROUP-ID="audio-eac3",LANGUAGE="it",NAME="Italiano",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="6"
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs/e1_de/playlist.m3u8",GROUP-ID="subs",LANGUAGE="de",NAME="Deutsch",DEFAULT=NO,AUTOSELECT=YES
#EXT-X-STREAM-INF:BANDWIDTH=130000,AVERAGE-BANDWIDTH=128000,CODECS="mp4a.40.2",AUDIO="audio-aac",CLOSED-CAPTIONS=NONE
audio/e1_it_aac/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=400000,AVERAGE-BANDWIDTH=390000,CODECS="ec-3",AUDIO="audio-eac3",CLOSED-CAPTIONS=NONE
audio/e1_it_eac3/playlist.m3u8
`
    const text = await mergeMasterPlaylists(existingMaster, addition, bandwidthOf)
    const merged = parseMaster(text)
    expect(merged.variants.map((v) => [v.uri, attribute(v, 'AUDIO'), attribute(v, 'CODECS'), attribute(v, 'BANDWIDTH')])).toEqual([
      ['video/720p/playlist.m3u8', 'audio-aac', 'avc1.64001f,mp4a.40.2', '1930000'],
      ['video/720p/playlist.m3u8', 'audio-eac3', 'avc1.64001f,ec-3', '2200000']
    ])
    const italian = merged.media.filter((m) => attribute(m, 'LANGUAGE') === 'it')
    expect(italian.map((m) => [attribute(m, 'GROUP-ID'), attribute(m, 'DEFAULT')])).toEqual([
      ['audio-aac', 'NO'],
      ['audio-eac3', 'YES']
    ])
    expect(text).toContain('URI="subs/e1_de/playlist.m3u8"')
    expect(merged.variants.every((v) => attribute(v, 'SUBTITLES') === 'subs')).toBe(true)
    // idempotent: merging the same addition twice changes nothing
    expect(await mergeMasterPlaylists(text, addition, bandwidthOf)).toBe(text)
  })

  it('keeps the mixed "audio" group of titles published before per-codec groups', async () => {
    const legacy = existingMaster
      .replace(/GROUP-ID="audio-aac"/g, 'GROUP-ID="audio"')
      .replace('CODECS="avc1.64001f,mp4a.40.2"', 'CODECS="avc1.64001f,mp4a.40.2,ac-3"')
      .replace('AUDIO="audio-aac"', 'AUDIO="audio"')
    const addition = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/e1_it_aac/playlist.m3u8",GROUP-ID="audio-aac",LANGUAGE="it",NAME="Italiano",DEFAULT=NO,AUTOSELECT=YES,CHANNELS="6"
#EXT-X-STREAM-INF:BANDWIDTH=130000,AVERAGE-BANDWIDTH=128000,CODECS="mp4a.40.2",AUDIO="audio-aac",CLOSED-CAPTIONS=NONE
audio/e1_it_aac/playlist.m3u8
`
    const merged = parseMaster(await mergeMasterPlaylists(legacy, addition, bandwidthOf))
    expect(merged.variants.map((v) => [attribute(v, 'AUDIO'), attribute(v, 'CODECS')])).toEqual([
      ['audio', 'avc1.64001f,mp4a.40.2,ac-3'],
      ['audio-aac', 'avc1.64001f,mp4a.40.2']
    ])
  })
})

describe('measureBandwidth', () => {
  it('reads segment sizes and durations from the playlist, ignoring the short tail for the peak', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lp-bw-'))
    try {
      writeFileSync(join(dir, 'seg_00001.m4s'), Buffer.alloc(6000))
      writeFileSync(join(dir, 'seg_00002.m4s'), Buffer.alloc(9000))
      writeFileSync(join(dir, 'seg_00003.m4s'), Buffer.alloc(3000))
      writeFileSync(
        join(dir, 'playlist.m3u8'),
        ['#EXTM3U', '#EXT-X-MAP:URI="init.mp4"', '#EXTINF:6.000,', 'seg_00001.m4s', '#EXTINF:6.000,', 'seg_00002.m4s', '#EXTINF:1.000,', 'seg_00003.m4s', '#EXT-X-ENDLIST', ''].join('\n')
      )
      // peak: 9000 B over 6 s = 12000 b/s (the 1 s tail would be 24000); average: 18000 B over 13 s
      expect(await measureBandwidth(join(dir, 'playlist.m3u8'))).toEqual({ peak: 12000, average: 11077 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

const existingMpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-live:2011" type="static" mediaPresentationDuration="PT20.02S">
  <Period id="0">
    <AdaptationSet id="1" contentType="video" maxWidth="1280" maxHeight="534" frameRate="24000/1001" segmentAlignment="true">
      <Representation id="0" bandwidth="1722778" codecs="avc1.64001f" mimeType="video/mp4" width="1280" height="534">
        <SegmentTemplate timescale="24000" initialization="video/720p/init.mp4" media="video/720p/seg_$Number%05d$.m4s" startNumber="1">
          <SegmentTimeline>
            <S t="0" d="144144" r="2"/>
          </SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
    <AdaptationSet id="0" contentType="audio" lang="es" segmentAlignment="true">
      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>
      <Representation id="1" bandwidth="131251" codecs="mp4a.40.2" mimeType="audio/mp4" audioSamplingRate="48000">
        <SegmentTemplate timescale="48000" initialization="audio/1_es_aac/init.mp4" media="audio/1_es_aac/seg_$Number%05d$.m4s" startNumber="1"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`

describe('mergeMpds', () => {
  it('appends video representations to the video set and new tracks as new sets with unique ids', () => {
    const addition = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT20.02S">
  <Period id="0">
    <AdaptationSet id="0" contentType="video" maxWidth="1920" maxHeight="800" segmentAlignment="true">
      <Representation id="0" bandwidth="3800000" codecs="avc1.640028" mimeType="video/mp4" width="1920" height="800">
        <SegmentTemplate timescale="24000" initialization="video/1080p/init.mp4" media="video/1080p/seg_$Number%05d$.m4s" startNumber="1"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet id="1" contentType="audio" lang="it" segmentAlignment="true">
      <Representation id="1" bandwidth="130000" codecs="mp4a.40.2" mimeType="audio/mp4" audioSamplingRate="48000">
        <SegmentTemplate timescale="48000" initialization="audio/e1_it_aac/init.mp4" media="audio/e1_it_aac/seg_$Number%05d$.m4s" startNumber="1"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`
    const merged = mergeMpds(existingMpd, addition)
    expect(merged).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(merged).toContain('contentType="video" maxWidth="1920" maxHeight="800"')
    expect(merged).toContain('initialization="video/720p/init.mp4"')
    expect(merged).toContain('initialization="video/1080p/init.mp4"')
    expect(merged).toContain('initialization="audio/e1_it_aac/init.mp4"')
    expect(merged).toContain('<Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/>')

    const representationIds = [...merged.matchAll(/<Representation id="(\d+)"/g)].map((m) => m[1])
    expect(new Set(representationIds).size).toBe(representationIds.length)
    expect(representationIds).toEqual(['0', '2', '1', '3'])
    const setIds = [...merged.matchAll(/<AdaptationSet id="(\d+)"/g)].map((m) => m[1])
    expect(setIds).toEqual(['1', '0', '2'])
    // only one Period, video set still first
    expect(merged.match(/<Period /g)).toHaveLength(1)
  })
})

describe('mergeMetadata', () => {
  const base: TitleMetadata = {
    schemaVersion: 1,
    titleId: 't',
    name: 'T',
    durationSeconds: 10,
    standards: ['hls'],
    manifests: { hls: 'master.m3u8' },
    segmentDurationSeconds: 6,
    renditions: [{ label: '720p', width: 1280, height: 534, bitrate: 1, maxBitrate: 2, codec: 'h264', path: 'video/720p' }],
    audioTracks: [{ id: '1_es_aac', language: 'es', name: 'Español', codec: 'aac', channels: 2, path: 'audio/1_es_aac' }],
    subtitleTracks: [],
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('unions renditions and tracks by key and bumps updatedAt', () => {
    const merged = mergeMetadata(base, {
      ...base,
      renditions: [base.renditions[0]!, { label: '480p', width: 854, height: 356, bitrate: 1, maxBitrate: 2, codec: 'h264', path: 'video/480p' }],
      subtitleTracks: [{ id: 'e1_de', language: 'de', name: 'Deutsch', format: 'vtt', forced: false, path: 'subs/e1_de' }]
    })
    expect(merged.renditions.map((r) => r.label)).toEqual(['720p', '480p'])
    expect(merged.audioTracks).toHaveLength(1)
    expect(merged.subtitleTracks.map((s) => s.id)).toEqual(['e1_de'])
    expect(merged.updatedAt > base.updatedAt).toBe(true)
    expect(merged.standards).toEqual(['hls'])
  })
})
