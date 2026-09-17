import { describe, expect, it } from 'vitest'
import { checkAccess, generateApiToken, isLoopback } from '../auth'

const LAN = { apiAccess: 'lan' as const, apiToken: 'secret-token-1234567890abcdef' }
const LOCAL = { apiAccess: 'local' as const, apiToken: 'secret-token-1234567890abcdef' }
const from = (ip: string, extra: Partial<Parameters<typeof checkAccess>[0]> = {}) => ({ ip, method: 'GET', ...extra })

describe('generateApiToken', () => {
  it('yields 32 URL-safe characters, different every time', () => {
    const a = generateApiToken()
    const b = generateApiToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('isLoopback', () => {
  it('recognises IPv4, IPv6 and IPv4-mapped loopback only', () => {
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopback('192.168.1.20')).toBe(false)
    expect(isLoopback(undefined)).toBe(false)
  })
})

describe('checkAccess', () => {
  it('always trusts loopback callers and CORS preflights', () => {
    expect(checkAccess(from('127.0.0.1'), LOCAL)).toEqual({ ok: true })
    expect(checkAccess(from('127.0.0.1'), { apiAccess: 'lan', apiToken: null })).toEqual({ ok: true })
    expect(checkAccess(from('192.168.1.20', { method: 'OPTIONS' }), LOCAL)).toEqual({ ok: true })
  })

  it('refuses the network entirely while access is local', () => {
    expect(checkAccess(from('192.168.1.20', { authorization: `Bearer ${LOCAL.apiToken}` }), LOCAL)).toMatchObject({ ok: false, statusCode: 403 })
  })

  it('requires the exact token from the network, as Bearer or X-Api-Key', () => {
    expect(checkAccess(from('192.168.1.20'), LAN)).toMatchObject({ ok: false, statusCode: 401 })
    expect(checkAccess(from('192.168.1.20', { authorization: 'Bearer nope' }), LAN)).toMatchObject({ ok: false, statusCode: 401 })
    expect(checkAccess(from('192.168.1.20', { authorization: `Bearer ${LAN.apiToken}x` }), LAN)).toMatchObject({ ok: false, statusCode: 401 })
    expect(checkAccess(from('192.168.1.20', { authorization: `bearer ${LAN.apiToken}` }), LAN)).toEqual({ ok: true })
    expect(checkAccess(from('192.168.1.20', { apiKey: LAN.apiToken }), LAN)).toEqual({ ok: true })
  })

  it('never lets anyone in while no token has been minted', () => {
    expect(checkAccess(from('192.168.1.20', { authorization: 'Bearer ' }), { apiAccess: 'lan', apiToken: null })).toMatchObject({ statusCode: 401 })
  })

  it('accepts ?token= only on WebSocket upgrades', () => {
    expect(checkAccess(from('192.168.1.20', { queryToken: LAN.apiToken }), LAN)).toMatchObject({ ok: false, statusCode: 401 })
    expect(checkAccess(from('192.168.1.20', { queryToken: LAN.apiToken, upgrade: 'websocket' }), LAN)).toEqual({ ok: true })
    expect(checkAccess(from('192.168.1.20', { queryToken: 'nope', upgrade: 'websocket' }), LAN)).toMatchObject({ statusCode: 401 })
  })
})
