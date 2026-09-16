import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { Binaries } from './types'

const TOOLS = ['ffmpeg', 'ffprobe', 'packager'] as const
type Tool = (typeof TOOLS)[number]

export class BinaryNotFoundError extends Error {
  constructor(tool: Tool, searched: string[]) {
    super(`No se encontró "${tool}". Buscado en: ${searched.join(', ')} y en PATH`)
    this.name = 'BinaryNotFoundError'
  }
}

export interface ResolveOptions {
  // Folder containing bin/<platform>-<arch>/ (project `resources/` in dev, process.resourcesPath packaged)
  resourcesDir?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: string
}

// Resolution order per tool: LP_<TOOL> env override → bundled resources → PATH
export function resolveBinaries(opts: ResolveOptions = {}): Binaries {
  const env = opts.env ?? process.env
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const exe = platform === 'win32' ? '.exe' : ''

  const resolveTool = (tool: Tool): string => {
    const searched: string[] = []

    const override = env[`LP_${tool.toUpperCase()}`]
    if (override) {
      if (isExecutable(override)) return override
      searched.push(override)
    }

    if (opts.resourcesDir) {
      const bundled = join(opts.resourcesDir, 'bin', `${platform}-${arch}`, `${tool}${exe}`)
      if (isExecutable(bundled)) return bundled
      searched.push(bundled)
    }

    const onPath = findOnPath(`${tool}${exe}`, env.PATH ?? '')
    if (onPath) return onPath

    throw new BinaryNotFoundError(tool, searched)
  }

  return { ffmpeg: resolveTool('ffmpeg'), ffprobe: resolveTool('ffprobe'), packager: resolveTool('packager') }
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findOnPath(fileName: string, pathVar: string): string | undefined {
  for (const dir of pathVar.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, fileName)
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}
