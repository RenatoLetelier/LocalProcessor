import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HardwareInfo } from '@pipeline/hardware'
import { ProcessError } from '@pipeline/exec'
import { computeConcurrency, resolveEncoder } from '../concurrency'
import { createTestServer, fakePipeline, FAKE_BINARIES, type TestServer } from '../../routes/__tests__/helpers'

const hardware = (preferred: HardwareInfo['preferred']): HardwareInfo => ({
  platform: 'win32',
  cpuThreads: 12,
  preferred,
  encoders: [{ kind: preferred, label: preferred, hardware: preferred !== 'libx264', available: true }]
})

describe('resolveEncoder / computeConcurrency', () => {
  it('honours the software preference and the absence of detection', () => {
    expect(resolveEncoder('software', hardware('h264_nvenc'))).toBe('libx264')
    expect(resolveEncoder('auto', null)).toBe('libx264')
    expect(resolveEncoder('auto', hardware('h264_qsv'))).toBe('h264_qsv')
  })

  it('spreads the NVENC session limit over the enabled ladder', () => {
    const base = { encoder: 'auto' as const, maxConcurrentJobs: 'auto' as const }
    expect(computeConcurrency({ ...base, qualities: ['2160p', '1080p', '720p', '480p'] }, hardware('h264_nvenc'))).toBe(2)
    expect(computeConcurrency({ ...base, qualities: ['1080p'] }, hardware('h264_nvenc'))).toBe(8)
    expect(computeConcurrency({ ...base, qualities: Array(10).fill('x') }, hardware('h264_nvenc'))).toBe(1)
  })

  it('runs 2 jobs on other hardware encoders and 1 on the CPU', () => {
    const base = { encoder: 'auto' as const, maxConcurrentJobs: 'auto' as const, qualities: ['720p'] }
    expect(computeConcurrency(base, hardware('h264_amf'))).toBe(2)
    expect(computeConcurrency(base, hardware('h264_videotoolbox'))).toBe(2)
    expect(computeConcurrency(base, hardware('libx264'))).toBe(1)
    expect(computeConcurrency({ ...base, encoder: 'software' }, hardware('h264_nvenc'))).toBe(1)
    expect(computeConcurrency(base, null)).toBe(1)
  })

  it('lets a manual override win', () => {
    expect(computeConcurrency({ encoder: 'auto', maxConcurrentJobs: 3, qualities: ['720p'] }, hardware('libx264'))).toBe(3)
  })
})

describe('software fallback in the runner', () => {
  let root: string
  let server: TestServer

  // The fake pipelines can finish before the test subscribes: check the row first
  const untilFinished = (jobId: string): Promise<void> =>
    new Promise((resolve) => {
      const status = server.db.repos.jobs.get(jobId)?.status
      if (status === 'done' || status === 'error') return resolve()
      const unsubscribe = server.events.subscribe((e) => {
        if (e.type === 'job.updated' && e.job.id === jobId && (e.job.status === 'done' || e.job.status === 'error')) {
          unsubscribe()
          resolve()
        }
      })
    })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lp-fallback-'))
    writeFileSync(join(root, 'movie.mkv'), 'x')
  })

  afterEach(async () => {
    await server.app.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('retries once on libx264 when the hardware encoder crashes ffmpeg', async () => {
    const kinds: string[] = []
    const real = fakePipeline({ ticks: 1 })
    server = await createTestServer({
      outputFolder: root,
      hardware: hardware('h264_nvenc'),
      pipeline: async (binaries, input, hooks) => {
        kinds.push(input.videoEncoder?.kind ?? 'none')
        if (input.videoEncoder?.kind === 'h264_nvenc') throw new ProcessError(FAKE_BINARIES.ffmpeg, 1, ['No NVENC capable devices found'], false)
        return real(binaries, input, hooks)
      }
    })
    const { job } = (await server.app.inject({ method: 'POST', url: '/titles', payload: { sourcePath: join(root, 'movie.mkv') } })).json()
    await untilFinished(job.id)
    expect(kinds).toEqual(['h264_nvenc', 'libx264'])
    expect(server.db.repos.jobs.get(job.id)?.status).toBe('done')
  })

  it('does not retry software failures or non-ffmpeg failures', async () => {
    const kinds: string[] = []
    server = await createTestServer({
      outputFolder: root,
      hardware: hardware('h264_nvenc'),
      pipeline: async (_binaries, input) => {
        kinds.push(input.videoEncoder?.kind ?? 'none')
        throw new ProcessError(FAKE_BINARIES.packager, 2, ['Packaging Error'], false)
      }
    })
    const { job } = (await server.app.inject({ method: 'POST', url: '/titles', payload: { sourcePath: join(root, 'movie.mkv') } })).json()
    await untilFinished(job.id)
    expect(kinds).toEqual(['h264_nvenc'])
    expect(server.db.repos.jobs.get(job.id)?.status).toBe('error')
  })

  it('exposes the detection and the derived concurrency on GET /system', async () => {
    server = await createTestServer({ outputFolder: root, hardware: hardware('h264_nvenc') })
    const res = await server.app.inject({ method: 'GET', url: '/system' })
    expect(res.json()).toMatchObject({ platform: 'win32', cpuThreads: 12, selectedEncoder: 'h264_nvenc', concurrency: 2 })
    expect(res.json().encoders).toEqual([{ kind: 'h264_nvenc', label: 'h264_nvenc', hardware: true, available: true }])

    await server.app.inject({ method: 'PUT', url: '/config', payload: { encoder: 'software' } })
    expect((await server.app.inject({ method: 'GET', url: '/system' })).json()).toMatchObject({ selectedEncoder: 'libx264', concurrency: 1 })
  })
})
