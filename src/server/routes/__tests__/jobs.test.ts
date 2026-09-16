import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Job } from '@shared/model'
import { createTestServer, fakePipeline, type TestServer } from './helpers'

let root: string
let server: TestServer

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'lp-jobs-'))
  writeFileSync(join(root, 'a.mkv'), 'a')
  writeFileSync(join(root, 'b.mkv'), 'b')
  server = await createTestServer({ outputFolder: root, pipeline: fakePipeline({ ticks: 200, tickMs: 20 }) })
})

afterEach(async () => {
  await server.app.close()
  rmSync(root, { recursive: true, force: true })
})

const enqueue = async (file: string): Promise<Job> =>
  (await server.app.inject({ method: 'POST', url: '/titles', payload: { sourcePath: join(root, file) } })).json().job

const untilStatus = (jobId: string, status: Job['status']): Promise<void> =>
  new Promise((resolve) => {
    if (server.db.repos.jobs.get(jobId)?.status === status) return resolve()
    const unsubscribe = server.events.subscribe((e) => {
      if (e.type === 'job.updated' && e.job.id === jobId && e.job.status === status) {
        unsubscribe()
        resolve()
      }
    })
  })

describe('GET /jobs', () => {
  it('lists active jobs by default and filters by status', async () => {
    const a = await enqueue('a.mkv')
    const b = await enqueue('b.mkv')
    await untilStatus(a.id, 'running')

    const active = (await server.app.inject({ method: 'GET', url: '/jobs' })).json() as Job[]
    expect(active.map((j) => [j.id, j.status])).toEqual([
      [a.id, 'running'],
      [b.id, 'queued']
    ])

    const queued = (await server.app.inject({ method: 'GET', url: '/jobs?status=queued' })).json() as Job[]
    expect(queued.map((j) => j.id)).toEqual([b.id])

    expect((await server.app.inject({ method: 'GET', url: '/jobs?status=weird' })).statusCode).toBe(400)
    expect((await server.app.inject({ method: 'GET', url: '/jobs?status=all' })).json()).toHaveLength(2)
    expect((await server.app.inject({ method: 'GET', url: `/jobs/${a.id}` })).json().id).toBe(a.id)
    expect((await server.app.inject({ method: 'GET', url: '/jobs/nope' })).statusCode).toBe(404)
  })
})

describe('POST /jobs/:id/cancel', () => {
  it('cancels running and queued jobs and rejects finished ones', async () => {
    const a = await enqueue('a.mkv')
    const b = await enqueue('b.mkv')
    await untilStatus(a.id, 'running')

    const cancelQueued = await server.app.inject({ method: 'POST', url: `/jobs/${b.id}/cancel` })
    expect(cancelQueued.statusCode).toBe(202)
    expect(cancelQueued.json().status).toBe('cancelled')

    const cancelRunning = await server.app.inject({ method: 'POST', url: `/jobs/${a.id}/cancel` })
    expect(cancelRunning.statusCode).toBe(202)
    expect(cancelRunning.json()).toMatchObject({ status: 'cancelled', error: 'Cancelado por el usuario' })

    expect((await server.app.inject({ method: 'POST', url: `/jobs/${a.id}/cancel` })).statusCode).toBe(409)
    expect((await server.app.inject({ method: 'POST', url: '/jobs/nope/cancel' })).statusCode).toBe(404)
  })
})

describe('WS /jobs/stream', () => {
  async function connect(headers?: Record<string, string>): Promise<{ socket: WebSocket; messages: unknown[]; next: () => Promise<unknown> }> {
    const address = server.app.server.listening ? server.app.listeningOrigin : await server.app.listen({ host: '127.0.0.1', port: 0 })
    const socket = new WebSocket(`${address.replace('http', 'ws')}/jobs/stream`, { headers })
    const messages: unknown[] = []
    const waiters: ((m: unknown) => void)[] = []
    socket.on('message', (data) => {
      const parsed = JSON.parse(data.toString())
      const waiter = waiters.shift()
      if (waiter) waiter(parsed)
      else messages.push(parsed)
    })
    const next = (): Promise<unknown> =>
      messages.length > 0 ? Promise.resolve(messages.shift()) : new Promise((resolve) => waiters.push(resolve))
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
      socket.once('close', () => resolve())
    })
    return { socket, messages, next }
  }

  it('sends a snapshot on connect and then streams job and title events', async () => {
    const { socket, next } = await connect()
    expect(await next()).toEqual({ type: 'snapshot', jobs: [] })

    const job = await enqueue('a.mkv')
    const types: string[] = []
    while (!types.includes('job.progress')) {
      const event = (await next()) as { type: string }
      types.push(event.type)
    }
    expect(types).toEqual(expect.arrayContaining(['title.updated', 'job.updated', 'job.progress']))
    expect(server.db.repos.jobs.get(job.id)?.status).toBe('running')
    socket.close()
  })

  it('rejects browser origins outside the allowlist', async () => {
    const { socket } = await connect({ origin: 'http://evil.example' })
    await new Promise<void>((resolve) => (socket.readyState === WebSocket.CLOSED ? resolve() : socket.once('close', () => resolve())))
    expect(socket.readyState).toBe(WebSocket.CLOSED)

    const { socket: ok, next } = await connect({ origin: server.allowedOrigins[0]! })
    expect(await next()).toMatchObject({ type: 'snapshot' })
    ok.close()
  })
})
