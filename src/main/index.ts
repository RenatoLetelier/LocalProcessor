import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import type { FastifyInstance } from 'fastify'
import { join } from 'node:path'
import { APP_NAME, DEFAULT_API_HOST, DEFAULT_API_PORT } from '@shared/constants'
import { startServer } from '@server/index'
import { createMainWindow, rendererOrigin } from './window'
import { buildRendererCsp, registerRendererScheme, serveRenderer } from './renderer-protocol'

const apiHost = DEFAULT_API_HOST
const apiPort = Number(process.env.LP_API_PORT) || DEFAULT_API_PORT
const apiBaseUrl = `http://${apiHost}:${apiPort}`

let server: FastifyInstance | undefined
let closingServer = false

// One running instance: the API port is fixed and SQLite has a single writer
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerRendererScheme()

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', (event) => {
    if (!server || closingServer) return
    event.preventDefault()
    closingServer = true
    void server.close().finally(() => app.quit())
  })

  app.whenReady().then(main).catch(fatal)
}

async function main(): Promise<void> {
  electronApp.setAppUserModelId('com.localprocessor.app')
  setupMenu()

  server = await startServer({
    host: apiHost,
    port: apiPort,
    version: app.getVersion(),
    allowedOrigins: [rendererOrigin()],
    logLevel: is.dev ? 'info' : 'warn'
  })
  server.log.info({ node: process.versions.node, electron: process.versions.electron }, 'runtime')

  serveRenderer(join(__dirname, '../renderer'), buildRendererCsp(apiBaseUrl))
  ipcMain.handle('app:api-base-url', () => apiBaseUrl)
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}

function setupMenu(): void {
  // macOS needs an app menu for Cmd+Q / copy-paste; elsewhere there is no menu bar at all
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }
}

function fatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  dialog.showErrorBox(APP_NAME, `No se pudo iniciar la aplicación:\n\n${message}`)
  app.exit(1)
}
