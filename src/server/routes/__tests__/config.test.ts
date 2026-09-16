import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { DEFAULT_CONFIG } from '@shared/config'
import { openDatabase } from '../../db'
import { createServer } from '../..'

let app: FastifyInstance

beforeEach(async () => {
  app = await createServer({
    host: '127.0.0.1',
    port: 0,
    version: 'test',
    repos: openDatabase(':memory:').repos,
    allowedOrigins: [],
    logLevel: 'silent'
  })
})

afterEach(() => app.close())

describe('GET /config', () => {
  it('returns the defaults on a fresh database', async () => {
    const res = await app.inject({ method: 'GET', url: '/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(DEFAULT_CONFIG)
  })
})

describe('PUT /config', () => {
  it('applies a partial patch and returns the full config', async () => {
    const res = await app.inject({ method: 'PUT', url: '/config', payload: { standards: ['hls'], qualities: ['720p'] } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ...DEFAULT_CONFIG, standards: ['hls'], qualities: ['720p'] })

    const again = await app.inject({ method: 'GET', url: '/config' })
    expect(again.json().standards).toEqual(['hls'])
  })

  it('rejects unknown keys instead of ignoring them', async () => {
    const res = await app.inject({ method: 'PUT', url: '/config', payload: { segmentDuration: 4 } })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/additional properties/)
  })

  it('rejects wrong types through the JSON schema', async () => {
    const res = await app.inject({ method: 'PUT', url: '/config', payload: { segmentDurationSeconds: 'six' } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects cross-field problems with a readable list', async () => {
    const res = await app.inject({ method: 'PUT', url: '/config', payload: { qualities: ['4k'], standards: [] } })
    expect(res.statusCode).toBe(400)
    expect(res.json().problems).toEqual([
      'standards: debe incluir al menos un estándar (hls, dash)',
      'qualities: "4k" no está definida en rungs'
    ])
  })

  it('accepts only existing absolute folders as outputFolder', async () => {
    const missing = await app.inject({ method: 'PUT', url: '/config', payload: { outputFolder: 'C:/no/such/folder' } })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().problems).toEqual(['outputFolder: la carpeta no existe'])

    const relative = await app.inject({ method: 'PUT', url: '/config', payload: { outputFolder: 'relative/out' } })
    expect(relative.json().problems).toEqual(['outputFolder: debe ser una ruta absoluta'])

    const ok = await app.inject({ method: 'PUT', url: '/config', payload: { outputFolder: tmpdir() } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().outputFolder).toBe(tmpdir())

    const cleared = await app.inject({ method: 'PUT', url: '/config', payload: { outputFolder: null } })
    expect(cleared.json().outputFolder).toBeNull()
  })

  it('validates each rung shape', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/config',
      payload: { rungs: { '1080p': { width: 1920, height: 1080 } } }
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/maxBitrateKbps/)
  })
})
