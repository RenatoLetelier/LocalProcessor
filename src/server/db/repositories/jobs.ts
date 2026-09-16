import type { DatabaseSync } from 'node:sqlite'
import type { Job, JobStatus, JobTipo } from '@shared/model'
import { asRow, asRows, newId, now, updateColumns } from './common'

export interface NewJob {
  id?: string
  title_id: string
  tipo: JobTipo
  config: unknown
  status?: JobStatus
}

const MUTABLE_COLUMNS = ['status', 'progress', 'current_step', 'error', 'started_at', 'finished_at'] as const

export type JobPatch = Partial<Pick<Job, (typeof MUTABLE_COLUMNS)[number]>>

export interface JobsRepository {
  create(input: NewJob): Job
  get(id: string): Job | undefined
  list(filter?: { status?: JobStatus | JobStatus[] }): Job[]
  listByTitle(titleId: string): Job[]
  update(id: string, patch: JobPatch): Job | undefined
}

export function createJobsRepository(db: DatabaseSync): JobsRepository {
  const insert = db.prepare(`
    INSERT INTO jobs (id, title_id, tipo, status, config_json, progress, created_at)
    VALUES (@id, @title_id, @tipo, @status, @config_json, 0, @created_at)
  `)
  const selectById = db.prepare('SELECT * FROM jobs WHERE id = ?')
  const selectAll = db.prepare('SELECT * FROM jobs ORDER BY created_at')
  const selectByTitle = db.prepare('SELECT * FROM jobs WHERE title_id = ? ORDER BY created_at')

  const get = (id: string): Job | undefined => asRow<Job>(selectById.get(id))

  return {
    create(input) {
      const id = input.id ?? newId()
      insert.run({
        id,
        title_id: input.title_id,
        tipo: input.tipo,
        status: input.status ?? 'queued',
        config_json: JSON.stringify(input.config ?? {}),
        created_at: now()
      })
      return get(id)!
    },
    get,
    list(filter) {
      if (!filter?.status) return asRows<Job>(selectAll.all())
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      const placeholders = statuses.map(() => '?').join(', ')
      return asRows<Job>(
        db.prepare(`SELECT * FROM jobs WHERE status IN (${placeholders}) ORDER BY created_at`).all(...statuses)
      )
    },
    listByTitle: (titleId) => asRows<Job>(selectByTitle.all(titleId)),
    update(id, patch) {
      updateColumns(db, 'jobs', id, patch, MUTABLE_COLUMNS)
      return get(id)
    }
  }
}
