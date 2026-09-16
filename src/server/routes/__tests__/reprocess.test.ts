import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Response as InjectResponse } from 'light-my-request'
import type { Job } from '@shared/model'
import { createTestServer, fakeIncremental, fakePipeline, type TestServer } from './helpers'

let root: string
let server: TestServer
let titleId: string

const untilJob = (jobId: string, status: Job['status']): Promise<Job> =>
  new Promise((resolve) => {
    const current = server.db.repos.jobs.get(jobId)
    if (current?.status === status) return resolve(current)
    const unsubscribe = server.events.subscribe((e) => {
      if (e.type === 'job.updated' && e.job.id === jobId && e.job.status === status) {
        unsubscribe()
        resolve(e.job)
      }
    })
  })

const reprocess = (payload: object): Promise<InjectResponse> =>
  server.app.inject({ method: 'POST', url: `/titles/${titleId}/reprocess`, payload })

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'lp-reprocess-'))
  writeFileSync(join(root, 'movie.mkv'), 'not really a movie')
  server = await createTestServer({ outputFolder: root, pipeline: fakePipeline({ ticks: 1 }), incremental: fakeIncremental({ ticks: 1 }) })
  // A published title: the initial job of the fake source yields 1080p/720p/480p, 2 audio tracks, PGS pending + SRT done
  const created = (await server.app.inject({ method: 'POST', url: '/titles', payload: { sourcePath: join(root, 'movie.mkv') } })).json()
  titleId = created.title.id
  await untilJob(created.job.id, 'done')
})

afterEach(async () => {
  await server.app.close()
  rmSync(root, { recursive: true, force: true })
})

describe('POST /titles/:id/reprocess validation', () => {
  it('rejects unknown titles, unknown tipos and busy titles', async () => {
    expect((await server.app.inject({ method: 'POST', url: '/titles/nope/reprocess', payload: { tipo: 'agregar_calidad', qualities: ['360p'] } })).statusCode).toBe(404)
    expect((await reprocess({ tipo: 'otro' })).statusCode).toBe(400)

    server.db.repos.titles.update(titleId, { status: 'processing' })
    const busy = await reprocess({ tipo: 'agregar_calidad', qualities: ['360p'] })
    expect(busy.statusCode).toBe(409)
  })

  it('checks qualities against the config, the title and the no-upscaling rule', async () => {
    const res = await reprocess({ tipo: 'agregar_calidad', qualities: ['720p', '2160p', '900p'] })
    expect(res.statusCode).toBe(400)
    expect(res.json().problems).toEqual([
      '720p: ya existe en el título',
      '2160p: el origen (1920×800) es menor que 3840×2160, sería upscaling',
      '900p: no está definida en la configuración'
    ])
    expect((await reprocess({ tipo: 'agregar_calidad', qualities: [] })).statusCode).toBe(400)
  })

  it('checks tracks: done tracks, image subtitles and missing files are refused', async () => {
    const res = await reprocess({ tipo: 'agregar_pista', audio: [1], subtitles: [3, 4, 9], files: [{ path: join(root, 'nope.srt'), kind: 'subtitle' }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().problems).toEqual([
      'audio 1: ya está incluido',
      'subtítulo 3: es de imagen, requiere OCR (no soportado)',
      'subtítulo 4: ya está incluido',
      'subtítulo 9: no existe en el título',
      `archivo no encontrado: ${join(root, 'nope.srt')}`
    ])
    expect((await reprocess({ tipo: 'agregar_pista' })).statusCode).toBe(400)
  })
})

describe('agregar_calidad', () => {
  it('queues an incremental job that adds the rendition rows without touching the rest', async () => {
    const res = await reprocess({ tipo: 'agregar_calidad', qualities: ['360p'] })
    expect(res.statusCode).toBe(202)
    const { job, title } = res.json()
    expect(job).toMatchObject({ tipo: 'agregar_calidad', status: 'queued' })
    expect(title.status).toBe('queued')
    expect(JSON.parse(job.config_json).qualities).toEqual(['360p'])

    await untilJob(job.id, 'done')
    const labels = server.db.repos.renditions.listByTitle(titleId).map((r) => r.label)
    expect(labels).toEqual(['1080p', '720p', '480p', '360p'])
    expect(server.db.repos.titles.get(titleId)?.status).toBe('done')
  })

  it('refuses to add to a title whose source file changed and keeps the title usable', async () => {
    writeFileSync(join(root, 'movie.mkv'), 'a different file now')
    const { job } = (await reprocess({ tipo: 'agregar_calidad', qualities: ['360p'] })).json()
    const failed = await untilJob(job.id, 'error')
    expect(failed.error).toMatch(/origen cambió/)
    expect(server.db.repos.titles.get(titleId)).toMatchObject({ status: 'done', error: expect.stringMatching(/origen cambió/) })
    expect(server.db.repos.renditions.listByTitle(titleId)).toHaveLength(3)
  })
})

describe('agregar_pista', () => {
  it('registers external files as pending tracks with negative indexes and completes them', async () => {
    writeFileSync(join(root, 'extra.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHola\n')
    writeFileSync(join(root, 'dub.m4a'), 'audio')
    const res = await reprocess({
      tipo: 'agregar_pista',
      files: [
        { path: join(root, 'extra.srt'), kind: 'subtitle', language: 'de', name: 'Deutsch', forced: true },
        { path: join(root, 'dub.m4a'), kind: 'audio', language: 'ita' }
      ]
    })
    expect(res.statusCode).toBe(202)
    const { job } = res.json()

    const pendingSub = server.db.repos.subtitleTracks.listByTitle(titleId).find((s) => s.source_path)
    expect(pendingSub).toMatchObject({ source_index: -1, language: 'de', title: 'Deutsch', formato_origen: 'subrip', status: 'pending' })
    const pendingAudio = server.db.repos.audioTracks.listByTitle(titleId).find((a) => a.source_path)
    expect(pendingAudio).toMatchObject({ source_index: -1, language: 'it', codec_origen: 'aac', channels: 2, status: 'pending' })
    expect(JSON.parse(job.config_json).externalTracks).toEqual([
      { kind: 'subtitle', sourceIndex: -1, path: join(root, 'extra.srt'), language: 'de', name: 'Deutsch', forced: true },
      { kind: 'audio', sourceIndex: -1, path: join(root, 'dub.m4a'), language: 'it', name: null }
    ])

    await untilJob(job.id, 'done')
    expect(server.db.repos.subtitleTracks.get(pendingSub!.id)).toMatchObject({ status: 'done', formato_salida: 'vtt' })
    expect(server.db.repos.audioTracks.get(pendingAudio!.id)).toMatchObject({ status: 'done', codec_salida: 'aac' })

    const again = await reprocess({ tipo: 'agregar_pista', files: [{ path: join(root, 'extra.srt'), kind: 'subtitle' }] })
    expect(again.json().problems).toEqual([`archivo ya agregado a este título: ${join(root, 'extra.srt')}`])
  })

  it('records a Dolby dub as its copy plus an AAC companion sharing the index', async () => {
    writeFileSync(join(root, 'dub.eac3'), 'audio')
    const { job } = (await reprocess({ tipo: 'agregar_pista', files: [{ path: join(root, 'dub.eac3'), kind: 'audio', language: 'fra', name: 'VF' }] })).json()
    await untilJob(job.id, 'done')

    const rows = server.db.repos.audioTracks.listByTitle(titleId).filter((a) => a.source_path === join(root, 'dub.eac3'))
    expect(rows.map((a) => [a.source_index, a.codec_origen, a.codec_salida, a.channels, a.title, a.status]).sort()).toEqual([
      [-1, 'eac3', 'aac', 6, 'VF', 'done'],
      [-1, 'eac3', 'eac3', 6, 'VF', 'done']
    ])
    // Both rows count as included: nothing left to add for that index
    const again = await reprocess({ tipo: 'agregar_pista', audio: [-1] })
    expect(again.json().problems).toEqual(['audio -1: ya está incluido'])
  })
})

describe('reprocesar_completo', () => {
  it('replays external tracks, applies overrides and refreshes the source hash', async () => {
    writeFileSync(join(root, 'extra.srt'), 'sub')
    const added = (await reprocess({ tipo: 'agregar_pista', files: [{ path: join(root, 'extra.srt'), kind: 'subtitle', language: 'fr' }] })).json()
    await untilJob(added.job.id, 'done')

    writeFileSync(join(root, 'movie.mkv'), 'replaced source')
    const before = server.db.repos.titles.get(titleId)!.source_hash
    const res = await reprocess({ tipo: 'reprocesar_completo', qualities: ['720p'], standards: ['hls'], segmentDurationSeconds: 4 })
    expect(res.statusCode).toBe(202)
    const { job } = res.json()
    const config = JSON.parse(job.config_json)
    expect(config).toMatchObject({ qualities: ['720p'], standards: ['hls'], segmentDurationSeconds: 4 })
    // Unnamed subtitle files take the file name, and the replay carries it
    expect(config.externalTracks).toEqual([{ kind: 'subtitle', sourceIndex: -1, path: join(root, 'extra.srt'), language: 'fr', name: 'extra' }])

    await untilJob(job.id, 'done')
    expect(server.db.repos.renditions.listByTitle(titleId).map((r) => r.label)).toEqual(['720p'])
    expect(server.db.repos.subtitleTracks.listByTitle(titleId).filter((s) => s.source_path)).toHaveLength(1)
    expect(server.db.repos.titles.get(titleId)!.source_hash).not.toBe(before)
  })

  it('rejects invalid overrides up front', async () => {
    const res = await reprocess({ tipo: 'reprocesar_completo', qualities: ['4k'] })
    expect(res.statusCode).toBe(400)
    expect(res.json().problems).toEqual(['qualities: "4k" no está definida en rungs'])
  })
})
