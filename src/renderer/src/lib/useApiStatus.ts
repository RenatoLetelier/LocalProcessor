import { useEffect, useState } from 'react'
import { api, apiBaseUrl } from './api'

export type ApiStatus =
  | { state: 'connecting'; baseUrl?: string }
  | { state: 'ok'; baseUrl: string; version: string }
  | { state: 'error'; baseUrl?: string; message: string }

const POLL_INTERVAL_MS = 5000

export function useApiStatus(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>({ state: 'connecting' })

  useEffect(() => {
    let cancelled = false

    const check = async (): Promise<void> => {
      const baseUrl = await apiBaseUrl()
      try {
        const health = await api.health()
        if (!cancelled) setStatus({ state: 'ok', baseUrl, version: health.version })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!cancelled) setStatus({ state: 'error', baseUrl, message })
      }
    }

    void check()
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return status
}
