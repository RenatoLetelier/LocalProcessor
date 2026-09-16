import { app, BrowserWindow, dialog, Menu } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import type { FastifyInstance } from 'fastify'
import { join } from 'node:path'
import { APP_NAME, DEFAULT_API_HOST, DEFAULT_API_PORT } from '@shared/constants'
import { startServer } from '@server/index'
import { DB_FILE_NAME, openDatabase, type AppDatabase } from '@server/db'
import { ServerEvents } from '@server/jobs/events'
import { JobRunner } from '@server/jobs/runner'
import { resolveBinaries } from '@pipeline/binaries'
import { detectHardware } from '@pipeline/hardware'
import { createMainWindow, rendererOrigin } from './window'
import { registerIpcHandlers } from './ipc'
import { buildRendererCsp, registerRendererScheme, serveRenderer } from './renderer-protocol'

const apiHost = DEFAULT_API_HOST
const apiPort = Number(process.env.LP_API_PORT) || DEFAULT_API_PORT
const apiBaseUrl = `http://${apiHost}:${apiPort}`

let database: AppDatabase | undefined
let server: FastifyInstance | undefined
let runner: JobRunner | undefined
let shuttingDown = false

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
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    void shutdown().finally(() => app.quit())
  })

  app.whenReady().then(main).catch(fatal)
}

async function main(): Promise<void> {
  electronApp.setAppUserModelId('com.localprocessor.app')
  setupMenu()

  const dataDir = process.env.LP_DATA_DIR || app.getPath('userData')
  database = openDatabase(join(dataDir, DB_FILE_NAME))

  const resourcesDir = is.dev ? join(app.getAppPath(), 'resources') : process.resourcesPath
  const binaries = resolveBinaries({ resourcesDir })

  // A one-second test encode per candidate: what ffmpeg lists is not what the drivers can do
  const hardware = await detectHardware(binaries)

  const events = new ServerEvents()
  // The runner logs through the Fastify logger, which exists only after startServer
  runner = new JobRunner({
    db: database.db,
    repos: database.repos,
    events,
    binaries,
    hardware,
    log: {
      info: (msg) => server?.log.info(msg),
      warn: (msg) => server?.log.warn(msg),
      error: (msg) => server?.log.error(msg),
      debug: (msg) => server?.log.debug(msg)
    }
  })
  server = await startServer({
    host: apiHost,
    port: apiPort,
    version: app.getVersion(),
    context: { repos: database.repos, events, runner, binaries, hardware },
    allowedOrigins: [rendererOrigin()],
    logLevel: is.dev ? 'info' : 'warn'
  })
  server.log.info({ node: process.versions.node, electron: process.versions.electron, dataDir, binaries }, 'runtime')
  server.log.info({ encoders: hardware.encoders.map((e) => `${e.kind}:${e.available ? 'ok' : e.error}`), preferred: hardware.preferred }, 'hardware')

  serveRenderer(join(__dirname, '../renderer'), buildRendererCsp(apiBaseUrl))
  registerIpcHandlers(apiBaseUrl, database.repos)
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  openWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
  runner.start()
}

function openWindow(): void {
  const win = createMainWindow()
  win.on('close', (event) => {
    if (shuttingDown || !runner?.hasRunning()) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Salir', 'Seguir procesando'],
      defaultId: 1,
      cancelId: 1,
      title: APP_NAME,
      message: 'Hay un job en curso.',
      detail: 'Si sales ahora se interrumpe y se reanudará desde cero la próxima vez que abras la aplicación.'
    })
    if (choice === 1) event.preventDefault()
  })
}

async function shutdown(): Promise<void> {
  await runner?.stop()
  await server?.close()
  database?.close()
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
