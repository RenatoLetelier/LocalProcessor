/// <reference types="vite/client" />
import type { AppBridge } from '@shared/bridge'

declare global {
  interface Window {
    app: AppBridge
  }
}
