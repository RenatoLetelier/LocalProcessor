import { statfs } from 'node:fs/promises'
import type { EncodePlan, SourceInfo } from '@pipeline/types'

// Bytes the finished title will take, from the planned ceilings (capped CRF
// usually lands below them, so this errs on the safe side).
export function estimateOutputBytes(source: SourceInfo, plan: EncodePlan): number {
  const seconds = source.durationSeconds
  const videoKbps = plan.renditions.reduce((sum, r) => sum + r.maxBitrateKbps, 0)
  const audioKbps = plan.audio.reduce((sum, a) => {
    if (a.bitrateKbps) return sum + a.bitrateKbps
    const original = source.audio.find((t) => t.index === a.sourceIndex)?.bitrate
    return sum + (original ? original / 1000 : 64 * a.channels)
  }, 0)
  return Math.round(((videoKbps + audioKbps) * 1000 * seconds) / 8)
}

// Peak usage during a job: encoded intermediates and packaged segments coexist
// until publish, plus a margin for container overhead.
export function estimatePeakBytes(source: SourceInfo, plan: EncodePlan): number {
  return Math.round(estimateOutputBytes(source, plan) * 2 * 1.1)
}

export async function freeBytes(path: string): Promise<number> {
  const stats = await statfs(path)
  return Number(stats.bavail) * Number(stats.bsize)
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
