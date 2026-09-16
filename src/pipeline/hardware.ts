import { cpus } from 'node:os'
import { ENCODERS, SOFTWARE_ENCODER, probeArgs, type EncoderKind } from './encoders'
import { capture, run } from './exec'
import type { Binaries } from './types'

export interface EncoderStatus {
  kind: EncoderKind
  label: string
  hardware: boolean
  // Compiled into ffmpeg and passed a real 1-second encode
  available: boolean
  error?: string
}

export interface HardwareInfo {
  platform: NodeJS.Platform
  cpuThreads: number
  encoders: EncoderStatus[]
  // Best available encoder in preference order (hardware first)
  preferred: EncoderKind
}

export interface DetectOptions {
  platform?: NodeJS.Platform
  probeTimeoutMs?: number
  // Injected in tests
  listEncoders?: (binaries: Binaries) => Promise<string>
  probe?: (binaries: Binaries, kind: EncoderKind) => Promise<void>
}

// "ffmpeg -encoders" only says what was compiled in; a driverless machine still
// lists h264_nvenc. Each candidate is exercised for a second to know for sure.
export async function detectHardware(binaries: Binaries, options: DetectOptions = {}): Promise<HardwareInfo> {
  const platform = options.platform ?? process.platform
  const list = options.listEncoders ?? ((b: Binaries) => capture(b.ffmpeg, ['-hide_banner', '-encoders']))
  const probe = options.probe ?? ((b: Binaries, kind: EncoderKind) => probeEncoder(b, kind, options.probeTimeoutMs ?? 20_000))

  const compiled = parseEncoderList(await list(binaries).catch(() => ''))
  const encoders: EncoderStatus[] = []

  for (const spec of ENCODERS) {
    if (!spec.platforms.includes(platform)) continue
    const status: EncoderStatus = { kind: spec.kind, label: spec.label, hardware: spec.hardware, available: false }
    if (!compiled.has(spec.kind)) {
      status.error = 'no incluido en este ffmpeg'
    } else {
      try {
        await probe(binaries, spec.kind)
        status.available = true
      } catch (error) {
        status.error = error instanceof Error ? firstLine(error.message) : String(error)
      }
    }
    encoders.push(status)
  }

  const preferred = encoders.find((e) => e.available)?.kind ?? SOFTWARE_ENCODER
  return { platform, cpuThreads: cpus().length, encoders, preferred }
}

export function parseEncoderList(text: string): Set<string> {
  const names = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    // " V....D h264_nvenc           NVIDIA NVENC H.264 encoder"
    const match = line.match(/^\s*V[A-Z.]{5}\s+([a-z0-9_]+)\b/)
    if (match) names.add(match[1]!)
  }
  return names
}

async function probeEncoder(binaries: Binaries, kind: EncoderKind, timeoutMs: number): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await run(binaries.ffmpeg, probeArgs(kind), { signal: controller.signal, stderrTailLines: 3 })
  } finally {
    clearTimeout(timer)
  }
}

// First ffmpeg complaint after the "terminó con código" header, without its "[component @ 0x…]" prefix
function firstLine(text: string): string {
  const lines = text
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim())
    .filter(Boolean)
  return lines[0] ?? text.split('\n')[0] ?? text
}
