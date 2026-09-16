import type { AppBridge } from '@shared/bridge'
import { DEFAULT_API_HOST, DEFAULT_API_PORT } from '@shared/constants'

// Outside Electron (the renderer opened in a plain browser during development)
// there is no preload: talk to the default API address and disable native dialogs.
const browserFallback: AppBridge = {
  getApiBaseUrl: async () => `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`,
  pickVideoFiles: async () => [],
  pickFolder: async () => null,
  openFolder: async () => undefined,
  pathForFile: (file) => file.name
}

export const bridge: AppBridge = typeof window !== 'undefined' && window.app ? window.app : browserFallback
export const isElectron = typeof window !== 'undefined' && Boolean(window.app)
