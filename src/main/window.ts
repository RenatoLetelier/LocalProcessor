import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { APP_NAME } from '@shared/constants'
import { RENDERER_ORIGIN } from './renderer-protocol'

export function rendererEntryUrl(): string {
  return is.dev && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : `${RENDERER_ORIGIN}/`
}

// WHATWG URL reports an opaque "null" origin for custom schemes, so the
// packaged origin cannot be derived by parsing the entry URL.
export function rendererOrigin(): string {
  const url = rendererEntryUrl()
  return url.startsWith('http') ? new URL(url).origin : RENDERER_ORIGIN
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#14171c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // The UI never opens popups nor navigates away from its own entry point
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererOrigin())) event.preventDefault()
  })

  void win.loadURL(rendererEntryUrl())
  return win
}
