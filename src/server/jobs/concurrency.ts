import type { AppConfig } from '@shared/config'
import { SOFTWARE_ENCODER, isHardwareEncoder, type EncoderKind } from '@pipeline/encoders'
import type { HardwareInfo } from '@pipeline/hardware'

// GeForce drivers cap concurrent NVENC sessions (8 since driver 550); each rendition
// of a job is one session, so the ceiling is spread over the enabled ladder.
const NVENC_SESSION_LIMIT = 8
const OTHER_HARDWARE_JOBS = 2

export function resolveEncoder(preference: AppConfig['encoder'], hardware: HardwareInfo | null): EncoderKind {
  if (preference === 'software' || !hardware) return SOFTWARE_ENCODER
  return hardware.preferred
}

export function computeConcurrency(config: Pick<AppConfig, 'encoder' | 'maxConcurrentJobs' | 'qualities'>, hardware: HardwareInfo | null): number {
  if (config.maxConcurrentJobs !== 'auto') return Math.max(1, config.maxConcurrentJobs)

  const encoder = resolveEncoder(config.encoder, hardware)
  // libx264 already saturates every core with one job
  if (!isHardwareEncoder(encoder)) return 1
  if (encoder === 'h264_nvenc') return Math.max(1, Math.floor(NVENC_SESSION_LIMIT / Math.max(1, config.qualities.length)))
  return OTHER_HARDWARE_JOBS
}
