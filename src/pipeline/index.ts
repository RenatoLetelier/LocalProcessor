import { existsSync } from 'node:fs'
import { mkdir, rename, rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildFfmpegArgs, extractSubtitles, runFfmpeg } from './ffmpeg'
import { METADATA_FILE, WORK_DIR, audioDir, renditionDir } from './layout'
import { buildMetadata, writeJsonAtomic } from './metadata'
import { ENC_DIR, PKG_DIR, buildPackagerArgs, runPackager } from './packager'
import { planEncode } from './plan'
import { probeSource } from './probe'
import type { Binaries, EncodePlan, PipelineHooks, PipelineInput, PipelineResult, PipelineStep } from './types'

export { resolveBinaries, BinaryNotFoundError } from './binaries'
export { ProcessError } from './exec'
export { ProbeError, probeSource } from './probe'
export { planEncode } from './plan'
export * from './types'

export class PipelineError extends Error {
  constructor(
    public readonly step: PipelineStep,
    message: string
  ) {
    super(message)
    this.name = 'PipelineError'
  }
}

// Share of the overall progress bar given to each step
const STEP_RANGES: Record<PipelineStep, [number, number]> = {
  probe: [0, 2],
  plan: [2, 3],
  encode: [3, 90],
  package: [90, 99],
  publish: [99, 100]
}

// probe → plan → encode → package → publish. Everything is written under
// <outputRoot>/.tmp/<titleId>/ and only renamed to <outputRoot>/<titleId>/ at the
// end, so a failure never leaves a half-built title where consumers can see it.
export async function processTitle(
  binaries: Binaries,
  input: PipelineInput,
  hooks: PipelineHooks = {}
): Promise<PipelineResult> {
  const report = (step: PipelineStep, stepPercent?: number, message?: string): void => {
    const [from, to] = STEP_RANGES[step]
    const percent = stepPercent === undefined ? from : from + ((to - from) * stepPercent) / 100
    hooks.onProgress?.({ step, stepPercent, percent: Math.round(percent * 10) / 10, message })
  }

  const finalDir = join(input.outputRoot, input.titleId)
  if (existsSync(finalDir)) throw new PipelineError('publish', `La carpeta de salida ya existe: ${finalDir}`)

  // Short work folder: Shaka Packager is not long-path aware on Windows (260 chars)
  const workDir = join(input.outputRoot, WORK_DIR, input.titleId.replace(/-/g, '').slice(0, 12))
  const encDir = join(workDir, ENC_DIR)
  const pkgDir = join(workDir, PKG_DIR)
  await rm(workDir, { recursive: true, force: true })
  await mkdir(encDir, { recursive: true })
  await mkdir(pkgDir, { recursive: true })

  try {
    report('probe')
    const source = await probeSource(binaries, input.sourcePath, hooks.signal)

    report('plan')
    const plan = planEncode(source, input.plan)
    if (plan.renditions.length === 0) {
      const reasons = plan.skipped.filter((s) => s.kind === 'rendition').map((s) => `${s.id}: ${s.reason}`)
      throw new PipelineError('plan', `Ninguna calidad configurada aplica a este origen (${reasons.join('; ')})`)
    }
    for (const item of plan.skipped) hooks.onLog?.(`omitido ${item.kind} ${item.id}: ${item.reason}`)
    for (const r of plan.renditions) {
      if (r.nativeFallback) hooks.onLog?.(`ninguna calidad configurada aplica: se genera ${r.label} a resolución nativa (${r.width}×${r.height})`)
    }
    assertPathLengths(workDir, plan)

    report('encode', 0)
    const subtitles = await extractSubtitles(binaries, source, plan.subtitles, encDir, { onLog: hooks.onLog, signal: hooks.signal })
    plan.subtitles = subtitles.extracted
    plan.skipped.push(...subtitles.failed)
    for (const item of subtitles.failed) hooks.onLog?.(`omitido subtitle ${item.id}: ${item.reason}`)

    const { args: ffmpegArgs, outputs } = buildFfmpegArgs(source, plan, encDir, input.videoEncoder)
    hooks.onLog?.(`ffmpeg ${ffmpegArgs.join(' ')}`)
    await runFfmpeg(binaries, ffmpegArgs, source.durationSeconds, {
      onProgress: (p) => report('encode', p.percent),
      onLog: hooks.onLog,
      signal: hooks.signal
    })
    report('encode', 100)

    report('package', 0)
    const packagerArgs = buildPackagerArgs(plan, input.standards)
    hooks.onLog?.(`packager ${packagerArgs.join(' ')}`)
    const streams = plan.renditions.length + plan.audio.length + plan.subtitles.length
    const expectedSegments = Math.ceil(source.durationSeconds / plan.actualSegmentSeconds) * streams
    await runPackager(binaries, packagerArgs, workDir, expectedSegments, {
      onProgress: (percent) => report('package', percent),
      onLog: hooks.onLog,
      signal: hooks.signal
    })
    report('package', 100)

    const metadata = await buildMetadata({
      titleId: input.titleId,
      name: input.name,
      standards: input.standards,
      source,
      plan,
      outputs
    })
    await writeJsonAtomic(join(pkgDir, METADATA_FILE), metadata)

    report('publish', 0)
    await mkdir(dirname(finalDir), { recursive: true })
    await rename(pkgDir, finalDir)
    await rm(workDir, { recursive: true, force: true })
    await rmdir(dirname(workDir)).catch(() => undefined)
    report('publish', 100)

    return { titleId: input.titleId, outputFolder: finalDir, source, plan, metadata }
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    await rmdir(dirname(workDir)).catch(() => undefined)
    throw error
  }
}

// Shaka writes "<dir>/packager-tempfile-<hex>" next to each playlist; on Windows the
// whole path must stay under MAX_PATH or packaging fails halfway through.
const WINDOWS_MAX_PATH = 259
const PACKAGER_TEMPFILE_LENGTH = 'packager-tempfile-0000-0000000000000000-0'.length

function assertPathLengths(workDir: string, plan: EncodePlan): void {
  if (process.platform !== 'win32') return
  const dirs = [...plan.renditions.map((r) => renditionDir(r.label)), ...plan.audio.map(audioDir)]
  const longest = Math.max(...dirs.map((dir) => join(workDir, PKG_DIR, dir).length + 1 + PACKAGER_TEMPFILE_LENGTH))
  if (longest > WINDOWS_MAX_PATH) {
    throw new PipelineError(
      'plan',
      `La carpeta de salida es demasiado larga para Windows: las rutas de trabajo llegarían a ${longest} caracteres (máximo ${WINDOWS_MAX_PATH}). Usa una carpeta de salida más corta.`
    )
  }
}
