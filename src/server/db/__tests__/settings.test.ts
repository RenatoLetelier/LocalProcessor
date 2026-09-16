import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/config'
import { openDatabase } from '..'

describe('settings repository', () => {
  it('returns the defaults on an empty database', () => {
    const { repos } = openDatabase(':memory:')
    expect(repos.settings.getConfig()).toEqual(DEFAULT_CONFIG)
  })

  it('merges a partial update over the stored config and persists it', () => {
    const { db, repos } = openDatabase(':memory:')

    const updated = repos.settings.updateConfig({ outputFolder: 'C:/media/out', segmentDurationSeconds: 4 })
    expect(updated).toEqual({ ...DEFAULT_CONFIG, outputFolder: 'C:/media/out', segmentDurationSeconds: 4 })

    repos.settings.updateConfig({ qualities: ['720p'] })
    expect(repos.settings.getConfig()).toEqual({
      ...DEFAULT_CONFIG,
      outputFolder: 'C:/media/out',
      segmentDurationSeconds: 4,
      qualities: ['720p']
    })

    const rows = db.prepare('SELECT key FROM settings ORDER BY key').all()
    expect(rows).toEqual([{ key: 'outputFolder' }, { key: 'qualities' }, { key: 'segmentDurationSeconds' }])
  })

  it('never hands out the shared default object', () => {
    const { repos } = openDatabase(':memory:')
    const config = repos.settings.getConfig()
    config.rungs['1080p']!.maxBitrateKbps = 1
    expect(DEFAULT_CONFIG.rungs['1080p']!.maxBitrateKbps).toBe(6000)
  })

  it('ignores stored keys that are no longer part of the config', () => {
    const { db, repos } = openDatabase(':memory:')
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('legacy', '1', '2026-01-01T00:00:00.000Z')").run()
    expect(repos.settings.getConfig()).toEqual(DEFAULT_CONFIG)
  })
})
