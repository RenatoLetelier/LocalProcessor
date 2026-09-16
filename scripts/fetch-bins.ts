// Downloads the third-party binaries the pipeline needs into resources/bin/<platform>-<arch>/.
// ffmpeg/ffprobe are taken from PATH during development; the installer phase adds them here.
import { execFileSync } from 'node:child_process'
import { chmodSync, createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'

const SHAKA_VERSION = 'v3.9.3'

const ASSETS: Record<string, string> = {
  'win32-x64': 'packager-win-x64.exe',
  'linux-x64': 'packager-linux-x64',
  'linux-arm64': 'packager-linux-arm64',
  'darwin-x64': 'packager-osx-x64',
  'darwin-arm64': 'packager-osx-arm64'
}

const target = `${process.platform}-${process.arch}`
const asset = ASSETS[target]
if (!asset) {
  console.error(`No hay binario de Shaka Packager para ${target}`)
  process.exit(1)
}

const binDir = resolve(__dirname, '..', 'resources', 'bin', target)
const binPath = join(binDir, process.platform === 'win32' ? 'packager.exe' : 'packager')
const url = `https://github.com/shaka-project/shaka-packager/releases/download/${SHAKA_VERSION}/${asset}`

async function main(): Promise<void> {
  if (existsSync(binPath) && currentVersion(binPath) === SHAKA_VERSION) {
    console.log(`Shaka Packager ${SHAKA_VERSION} ya está en ${binPath}`)
    return
  }

  mkdirSync(binDir, { recursive: true })
  console.log(`Descargando ${url}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Descarga fallida: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(binPath))
  if (process.platform !== 'win32') chmodSync(binPath, 0o755)

  console.log(`Listo: ${binPath} (${currentVersion(binPath)})`)
}

function currentVersion(path: string): string | undefined {
  try {
    const out = execFileSync(path, ['--version'], { encoding: 'utf8', windowsHide: true })
    return out.match(/v\d+\.\d+\.\d+/)?.[0]
  } catch {
    return undefined
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
