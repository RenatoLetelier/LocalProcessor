import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { FastifyInstance } from 'fastify'
import type { Binaries, PipelineHooks, PipelineInput, PipelineResult, SourceInfo } from '@pipeline/types'
import { planEncode } from '@pipeline/plan'
import { createServer } from '../..'
import { openDatabase, type AppDatabase } from '../../db'
import { ServerEvents } from '../../jobs/events'
import { JobRunner, type PipelineFn } from '../../jobs/runner'
import type { Prober } from '../../jobs/enqueue'

export const FAKE_BINARIES: Binaries = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', packager: 'packager' }

export const fakeSource = (path: string, over: Partial<SourceInfo['video']> = {}): SourceInfo => ({
  path,
  sizeBytes: 1_000_000,
  durationSeconds: 60,
  containerBitrate: 5_000_000,
  video: {
    index: 0,
    codec: 'h264',
    width: 1920,
    height: 800,
    displayWidth: 1920,
    displayHeight: 800,
    fps: { num: 24, den: 1 },
    bitrate: 4_000_000,
    bitrateEstimated: false,
    pixelFormat: 'yuv420p',
    ...over
  },
  audio: [
    { index: 1, codec: 'aac', channels: 2, channelLayout: 'stereo', sampleRate: 48000, bitrate: 128000, language: 'spa', title: null, isDefault: true },
    { index: 2, codec: 'dts', channels: 6, channelLayout: '5.1', sampleRate: 48000, bitrate: null, language: 'eng', title: 'Comentarios', isDefault: false }
  ],
  subtitles: [{ index: 3, codec: 'hdmv_pgs_subtitle', language: 'spa', title: null, isForced: false, isImage: true }]
})

export const fakeProbe: Prober = async (_binaries, path) => fakeSource(path)

export interface FakePipelineOptions {
  // Number of progress ticks and the pause between them (lets tests cancel mid-run)
  ticks?: number
  tickMs?: number
  fail?: string
}

// Stand-in for processTitle: same contract, no ffmpeg. Writes a minimal output folder.
export function fakePipeline(options: FakePipelineOptions = {}): PipelineFn {
  const { ticks = 3, tickMs = 5, fail } = options
  return async (_binaries: Binaries, input: PipelineInput, hooks: PipelineHooks = {}): Promise<PipelineResult> => {
    const source = fakeSource(input.sourcePath)
    const plan = planEncode(source, input.plan)
    hooks.onProgress?.({ step: 'probe', percent: 0 })
    for (let i = 1; i <= ticks; i++) {
      if (hooks.signal?.aborted) throw new Error('abortado')
      await sleep(tickMs)
      hooks.onProgress?.({ step: 'encode', stepPercent: (i / ticks) * 100, percent: 3 + (87 * i) / ticks })
    }
    if (fail) throw new Error(fail)
    hooks.onLog?.('fake pipeline done')

    const outputFolder = join(input.outputRoot, input.titleId)
    mkdirSync(outputFolder, { recursive: true })
    const metadata: PipelineResult['metadata'] = {
      schemaVersion: 1,
      titleId: input.titleId,
      name: input.name,
      durationSeconds: source.durationSeconds,
      standards: input.standards,
      manifests: { hls: 'master.m3u8' },
      segmentDurationSeconds: plan.actualSegmentSeconds,
      renditions: plan.renditions.map((r) => ({
        label: r.label,
        width: r.width,
        height: r.height,
        bitrate: r.maxBitrateKbps * 900,
        maxBitrate: r.maxBitrateKbps * 1000,
        codec: 'h264',
        path: `video/${r.label}`
      })),
      audioTracks: [],
      subtitleTracks: [],
      updatedAt: new Date().toISOString()
    }
    writeFileSync(join(outputFolder, 'metadata.json'), JSON.stringify(metadata))
    hooks.onProgress?.({ step: 'publish', percent: 100 })
    return { titleId: input.titleId, outputFolder, source, plan, metadata }
  }
}

export interface TestServer {
  app: FastifyInstance
  db: AppDatabase
  events: ServerEvents
  runner: JobRunner
  allowedOrigins: string[]
}

export async function createTestServer(options: { pipeline?: PipelineFn; outputFolder?: string; concurrency?: number } = {}): Promise<TestServer> {
  const db = openDatabase(':memory:')
  const events = new ServerEvents()
  const runner = new JobRunner({
    db: db.db,
    repos: db.repos,
    events,
    binaries: FAKE_BINARIES,
    pipeline: options.pipeline ?? fakePipeline(),
    concurrency: options.concurrency
  })
  if (options.outputFolder) db.repos.settings.updateConfig({ outputFolder: options.outputFolder })

  const allowedOrigins = ['app://renderer']
  const app = await createServer({
    host: '127.0.0.1',
    port: 0,
    version: 'test',
    context: { repos: db.repos, events, runner, binaries: FAKE_BINARIES, probe: fakeProbe, checkDiskSpace: false },
    allowedOrigins,
    logLevel: 'silent'
  })
  app.addHook('onClose', async () => {
    await runner.stop()
    db.close()
  })
  return { app, db, events, runner, allowedOrigins }
}
