import type { DatabaseSync } from 'node:sqlite'
import type { ArtifactStatus, Rendition } from '@shared/model'
import { asRow, asRows, newId, updateColumns } from './common'

export interface NewRendition {
  id?: string
  title_id: string
  label: string
  width: number
  height: number
  bitrate: number
  video_codec: string
  status?: ArtifactStatus
}

const MUTABLE_COLUMNS = ['width', 'height', 'bitrate', 'video_codec', 'status'] as const

export type RenditionPatch = Partial<Pick<Rendition, (typeof MUTABLE_COLUMNS)[number]>>

export interface RenditionsRepository {
  create(input: NewRendition): Rendition
  get(id: string): Rendition | undefined
  listByTitle(titleId: string): Rendition[]
  update(id: string, patch: RenditionPatch): Rendition | undefined
  remove(id: string): boolean
}

export function createRenditionsRepository(db: DatabaseSync): RenditionsRepository {
  const insert = db.prepare(`
    INSERT INTO renditions (id, title_id, label, width, height, bitrate, video_codec, status)
    VALUES (@id, @title_id, @label, @width, @height, @bitrate, @video_codec, @status)
  `)
  const selectById = db.prepare('SELECT * FROM renditions WHERE id = ?')
  const selectByTitle = db.prepare('SELECT * FROM renditions WHERE title_id = ? ORDER BY height DESC, bitrate DESC')
  const deleteById = db.prepare('DELETE FROM renditions WHERE id = ?')

  const get = (id: string): Rendition | undefined => asRow<Rendition>(selectById.get(id))

  return {
    create(input) {
      const id = input.id ?? newId()
      insert.run({
        id,
        title_id: input.title_id,
        label: input.label,
        width: input.width,
        height: input.height,
        bitrate: input.bitrate,
        video_codec: input.video_codec,
        status: input.status ?? 'pending'
      })
      return get(id)!
    },
    get,
    listByTitle: (titleId) => asRows<Rendition>(selectByTitle.all(titleId)),
    update(id, patch) {
      updateColumns(db, 'renditions', id, patch, MUTABLE_COLUMNS)
      return get(id)
    },
    remove: (id) => deleteById.run(id).changes > 0
  }
}
