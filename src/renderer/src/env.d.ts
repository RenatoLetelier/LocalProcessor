/// <reference types="vite/client" />
import type { AppBridge } from '@shared/bridge'

declare global {
  interface Window {
    // Injected by the preload; absent when the renderer runs in a plain browser
    app?: AppBridge
  }
}
