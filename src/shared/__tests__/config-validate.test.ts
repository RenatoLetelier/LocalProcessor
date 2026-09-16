import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type AppConfig } from '../config'
import { validateConfig } from '../config-validate'

const withOverrides = (patch: Partial<AppConfig>): AppConfig => ({ ...structuredClone(DEFAULT_CONFIG), ...patch })

describe('validateConfig', () => {
  it('accepts the default config', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([])
  })

  it('requires every enabled quality to be a defined rung', () => {
    const problems = validateConfig(withOverrides({ qualities: ['1080p', '900p'] }))
    expect(problems).toEqual(['qualities: "900p" no está definida en rungs'])
  })

  it('rejects empty or duplicated standards and qualities', () => {
    expect(validateConfig(withOverrides({ standards: [] }))).toContain(
      'standards: debe incluir al menos un estándar (hls, dash)'
    )
    expect(validateConfig(withOverrides({ standards: ['hls', 'hls'] }))).toContain('standards: contiene valores repetidos')
    expect(validateConfig(withOverrides({ qualities: [] }))).toContain('qualities: debe incluir al menos una calidad')
    expect(validateConfig(withOverrides({ qualities: ['720p', '720p'] }))).toContain('qualities: contiene valores repetidos')
  })

  it('requires even rung dimensions and a positive bitrate', () => {
    const rungs = { ...DEFAULT_CONFIG.rungs, odd: { width: 853, height: 480, maxBitrateKbps: 0 } }
    expect(validateConfig(withOverrides({ rungs }))).toEqual([
      'rungs.odd.width: debe ser un entero par ≥ 16',
      'rungs.odd.maxBitrateKbps: debe ser un entero positivo'
    ])
  })

  it('keeps segment duration inside 1..60 whole seconds', () => {
    expect(validateConfig(withOverrides({ segmentDurationSeconds: 0 }))).toHaveLength(1)
    expect(validateConfig(withOverrides({ segmentDurationSeconds: 2.5 }))).toHaveLength(1)
    expect(validateConfig(withOverrides({ segmentDurationSeconds: 60 }))).toEqual([])
  })
})
