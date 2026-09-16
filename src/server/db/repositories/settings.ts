import type { DatabaseSync } from 'node:sqlite'
import { CONFIG_KEYS, DEFAULT_CONFIG, type AppConfig } from '@shared/config'
import { withTransaction } from '../transaction'
import { now } from './common'

export interface SettingsRepository {
  getConfig(): AppConfig
  updateConfig(patch: Partial<AppConfig>): AppConfig
}

// One row per top-level config key, value stored as JSON. Unknown keys are
// ignored on read so defaults added in future versions surface automatically.
export function createSettingsRepository(db: DatabaseSync): SettingsRepository {
  const selectAll = db.prepare('SELECT key, value FROM settings')
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, @updated_at)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)

  function getConfig(): AppConfig {
    const stored = new Map<string, unknown>()
    for (const row of selectAll.all() as { key: string; value: string }[]) {
      stored.set(row.key, JSON.parse(row.value))
    }

    const config = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>
    for (const key of CONFIG_KEYS) {
      if (stored.has(key)) config[key] = stored.get(key)
    }
    return config as unknown as AppConfig
  }

  function updateConfig(patch: Partial<AppConfig>): AppConfig {
    withTransaction(db, () => {
      const updatedAt = now()
      for (const key of CONFIG_KEYS) {
        if (patch[key] === undefined) continue
        upsert.run({ key, value: JSON.stringify(patch[key]), updated_at: updatedAt })
      }
    })
    return getConfig()
  }

  return { getConfig, updateConfig }
}
