import { contextBridge, ipcRenderer } from 'electron'
import type { AppBridge } from '@shared/bridge'

const bridge: AppBridge = {
  getApiBaseUrl: () => ipcRenderer.invoke('app:api-base-url')
}

contextBridge.exposeInMainWorld('app', bridge)
