import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AppConfig } from '@shared/config'

// 24 random bytes → 32 URL-safe characters, enough to paste by hand
export function generateApiToken(): string {
  return randomBytes(24).toString('base64url')
}

export function isLoopback(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

export interface AccessRequest {
  ip: string | undefined
  method: string
  authorization?: string
  apiKey?: string
  upgrade?: string
  queryToken?: string
}

export type AccessDecision = { ok: true } | { ok: false; statusCode: 401 | 403; message: string }

// Callers on this machine (the UI, local programs) are trusted as in v1. Anyone
// else needs LAN access enabled plus the token, sent as "Authorization: Bearer"
// or "X-Api-Key"; the WebSocket also takes ?token= because browsers cannot set
// headers on it. CORS preflights carry no credentials and are let through.
export function checkAccess(request: AccessRequest, config: Pick<AppConfig, 'apiAccess' | 'apiToken'>): AccessDecision {
  if (isLoopback(request.ip) || request.method === 'OPTIONS') return { ok: true }
  if (config.apiAccess !== 'lan') return { ok: false, statusCode: 403, message: 'La API solo acepta conexiones desde este equipo' }

  const upgrade = request.upgrade?.toLowerCase() === 'websocket'
  const presented = bearerToken(request.authorization) ?? request.apiKey ?? (upgrade ? request.queryToken : undefined)
  if (!presented || !config.apiToken || !sameToken(presented, config.apiToken)) {
    return { ok: false, statusCode: 401, message: 'Token inválido o ausente: envía "Authorization: Bearer <token>"' }
  }
  return { ok: true }
}

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)$/i)
  return match?.[1]
}

function sameToken(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
