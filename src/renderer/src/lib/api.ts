import type { HealthResponse } from '@shared/api'

let baseUrlPromise: Promise<string> | undefined

export function apiBaseUrl(): Promise<string> {
  baseUrlPromise ??= window.app.getApiBaseUrl()
  return baseUrlPromise
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${await apiBaseUrl()}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = {
  health: () => apiGet<HealthResponse>('/health')
}
