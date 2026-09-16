// End-to-end run with the real ffmpeg/ffprobe/packager binaries on a 6-second
// synthetic clip. Skipped when the binaries are not available.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/config'
import { ProcessError, processTitle, resolveBinaries, type Binaries, type ProgressEvent } from '..'
import { run } from '../exec'
import { generateSample } from '../testing/sample'

let binaries: Binaries | undefined
try {
  binaries = resolveBinaries({ resourcesDir: resolve(__dirname, '../../../resources') })
} catch {
  binaries = undefined
}

describe.skipIf(!binaries)('pipeline (integration)', () => {
  const root = mkdtempSync(join(tmpdir(), 'lp-it-'))
  const titleId = '00000000-0000-4000-8000-000000000001'
  const events: ProgressEvent[] = []
  const logs: string[] = []
  let outputFolder: string

  beforeAll(async () => {
    const sample = generateSample(binaries!.ffmpeg, { out: join(root, 'sample.mkv'), durationSeconds: 6 })
    const result = await processTitle(
      binaries!,
      {
        titleId,
        name: 'Sample',
        sourcePath: sample,
        outputRoot: join(root, 'out'),
        standards: ['hls'],
        plan: { rungs: DEFAULT_CONFIG.rungs, qualities: ['720p'], segmentDurationSeconds: 2 },
        videoEncoder: { preset: 'veryfast' }
      },
      { onProgress: (e) => events.push(e), onLog: (l) => logs.push(l) }
    )
    outputFolder = result.outputFolder
  }, 120_000)

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('publishes the title folder with the documented layout and no leftovers', () => {
    expect(outputFolder).toBe(join(root, 'out', titleId))
    const files = readdirSync(outputFolder, { recursive: true }).map(String).map((f) => f.replace(/\\/g, '/')).sort()
    expect(files).toEqual(
      expect.arrayContaining([
        'master.m3u8',
        'metadata.json',
        'video/720p/init.mp4',
        'video/720p/playlist.m3u8',
        'video/720p/seg_00001.m4s',
        'video/720p/seg_00003.m4s',
        'audio/1_es_aac/playlist.m3u8',
        'audio/2_en_aac/playlist.m3u8'
      ])
    )
    expect(existsSync(join(root, 'out', '.tmp'))).toBe(false)
  })

  it('cuts segments exactly on the GOP (2 s at 23.976 fps = 48 frames = 2.002 s)', () => {
    const playlist = readFileSync(join(outputFolder, 'video/720p/playlist.m3u8'), 'utf8')
    const durations = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]))
    expect(durations.slice(0, -1).every((d) => Math.abs(d - 2.002) < 0.001)).toBe(true)
    expect(playlist).toContain('#EXT-X-MAP:URI="init.mp4"')
    expect(playlist).toContain('#EXT-X-ENDLIST')
  })

  it('exposes both audio tracks in the master playlist with language, name and channels', () => {
    const master = readFileSync(join(outputFolder, 'master.m3u8'), 'utf8')
    expect(master).toContain('LANGUAGE="es",NAME="Español",DEFAULT=YES')
    expect(master).toContain('LANGUAGE="en",NAME="English"')
    expect(master).toContain('CHANNELS="6"')
    expect(master).toMatch(/RESOLUTION=1280x534/)
  })

  it('writes a metadata.json consistent with the output', () => {
    const metadata = JSON.parse(readFileSync(join(outputFolder, 'metadata.json'), 'utf8'))
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      titleId,
      name: 'Sample',
      standards: ['hls'],
      manifests: { hls: 'master.m3u8' },
      renditions: [{ label: '720p', width: 1280, height: 534, codec: 'h264', path: 'video/720p' }],
      audioTracks: [
        { id: '1_es_aac', language: 'es', codec: 'aac', channels: 2, path: 'audio/1_es_aac' },
        { id: '2_en_aac', language: 'en', codec: 'aac', channels: 6, path: 'audio/2_en_aac' }
      ],
      subtitleTracks: []
    })
    expect(metadata.durationSeconds).toBeCloseTo(6, 0)
    expect(metadata.segmentDurationSeconds).toBeCloseTo(2.002, 3)
    // The synthetic clip is below the 720p ceiling, so rule 1 caps the rung at the source bitrate
    expect(metadata.renditions[0].maxBitrate).toBeLessThanOrEqual(3_000_000)
    expect(metadata.renditions[0].bitrate).toBeGreaterThan(0)
  })

  it('leaves nothing behind when a run fails', async () => {
    await expect(
      processTitle(binaries!, {
        titleId: '00000000-0000-4000-8000-00000000dead',
        name: 'Missing',
        sourcePath: join(root, 'does-not-exist.mkv'),
        outputRoot: join(root, 'out'),
        standards: ['hls'],
        plan: { rungs: DEFAULT_CONFIG.rungs, qualities: ['720p'], segmentDurationSeconds: 6 }
      })
    ).rejects.toBeInstanceOf(ProcessError)
    expect(existsSync(join(root, 'out', '00000000-0000-4000-8000-00000000dead'))).toBe(false)
    expect(readdirSync(join(root, 'out', '.tmp'), { recursive: false })).toEqual([])
  })

  it('kills the child process when the signal aborts', async () => {
    const controller = new AbortController()
    const pending = run(binaries!.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=64x64', '-t', '60', '-f', 'null', '-'], {
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 200)
    await expect(pending).rejects.toMatchObject({ name: 'ProcessError', aborted: true })
  })

  it('reports monotonic progress through every step', () => {
    const steps = [...new Set(events.map((e) => e.step))]
    expect(steps).toEqual(['probe', 'plan', 'encode', 'package', 'publish'])
    const percents = events.map((e) => e.percent)
    expect(percents.every((p, i) => i === 0 || p >= percents[i - 1]!)).toBe(true)
    expect(percents.at(-1)).toBe(100)
    expect(logs.some((l) => l.includes('omitido subtitle 3'))).toBe(true)
  })
})
