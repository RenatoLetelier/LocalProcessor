import type { DatabaseSync } from 'node:sqlite'
import { migrations, type Migration } from './migrations'
import { withTransaction } from './transaction'

export function runMigrations(db: DatabaseSync, list: Migration[] = migrations): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
  )
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
  const appliedNow: number[] = []

  for (const migration of [...list].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue
    withTransaction(db, () => {
      db.exec(migration.sql)
      record.run(migration.version, migration.name, new Date().toISOString())
    })
    appliedNow.push(migration.version)
  }

  return appliedNow
}
