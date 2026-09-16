// Contract between preload (implements) and renderer (consumes) via window.app
export interface AppBridge {
  getApiBaseUrl(): Promise<string>
}
