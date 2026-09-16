export type Standard = 'hls' | 'dash'
export type EncoderPreference = 'auto' | 'software'
export type ConcurrencyPreference = 'auto' | number

export interface Rung {
  // Maximum box: renditions are the source scaled to fit inside it, never upscaled
  width: number
  height: number
  maxBitrateKbps: number
}

export interface AppConfig {
  outputFolder: string | null
  standards: Standard[]
  // Enabled rung labels, must exist as keys of `rungs`
  qualities: string[]
  rungs: Record<string, Rung>
  segmentDurationSeconds: number
  // auto = best hardware encoder that works on this machine, software = always libx264
  encoder: EncoderPreference
  // auto = derived from the detected hardware and the number of enabled qualities
  maxConcurrentJobs: ConcurrencyPreference
}

export const DEFAULT_RUNGS: Record<string, Rung> = {
  '2160p': { width: 3840, height: 2160, maxBitrateKbps: 16000 },
  '1080p': { width: 1920, height: 1080, maxBitrateKbps: 6000 },
  '720p': { width: 1280, height: 720, maxBitrateKbps: 3000 },
  '480p': { width: 854, height: 480, maxBitrateKbps: 1500 },
  '360p': { width: 640, height: 360, maxBitrateKbps: 800 }
}

export const DEFAULT_CONFIG: AppConfig = {
  outputFolder: null,
  standards: ['hls', 'dash'],
  qualities: ['2160p', '1080p', '720p', '480p'],
  rungs: DEFAULT_RUNGS,
  segmentDurationSeconds: 6,
  encoder: 'auto',
  maxConcurrentJobs: 'auto'
}

export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]
