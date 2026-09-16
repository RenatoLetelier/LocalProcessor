import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { runMigrations } from './migrate'
import { createRepositories, type Repositories } from './repositories'

export interface AppDatabase {
  db: DatabaseSync
  repos: Repositories
  close(): void
}

export const DB_FILE_NAME = 'localprocessor.db'

export function openDatabase(file: string): AppDatabase {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })

  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)
  runMigrations(db)

  return { db, repos: createRepositories(db), close: () => db.close() }
}
