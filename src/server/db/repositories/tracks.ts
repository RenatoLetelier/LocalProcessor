import type { DatabaseSync } from 'node:sqlite'
import type { ArtifactStatus, AudioTrack, SubtitleTrack } from '@shared/model'
import { asRow, asRows, newId, updateColumns } from './common'

export interface NewAudioTrack {
  id?: string
  title_id: string
  source_index: number
  language?: string | null
  title?: string | null
  codec_origen: string
  codec_salida?: string | null
  channels?: number | null
  status?: ArtifactStatus
}

export interface NewSubtitleTrack {
  id?: string
  title_id: string
  source_index: number
  language?: string | null
  title?: string | null
  formato_origen: string
  formato_salida?: string | null
  requiere_ocr?: boolean
  status?: ArtifactStatus
}

const AUDIO_MUTABLE = ['language', 'title', 'codec_salida', 'channels', 'status'] as const
const SUBTITLE_MUTABLE = ['language', 'title', 'formato_salida', 'requiere_ocr', 'status'] as const

export type AudioTrackPatch = Partial<Pick<AudioTrack, (typeof AUDIO_MUTABLE)[number]>>
export type SubtitleTrackPatch = Partial<Pick<SubtitleTrack, (typeof SUBTITLE_MUTABLE)[number]>>

export interface AudioTracksRepository {
  create(input: NewAudioTrack): AudioTrack
  get(id: string): AudioTrack | undefined
  listByTitle(titleId: string): AudioTrack[]
  update(id: string, patch: AudioTrackPatch): AudioTrack | undefined
  remove(id: string): boolean
}

export interface SubtitleTracksRepository {
  create(input: NewSubtitleTrack): SubtitleTrack
  get(id: string): SubtitleTrack | undefined
  listByTitle(titleId: string): SubtitleTrack[]
  update(id: string, patch: SubtitleTrackPatch): SubtitleTrack | undefined
  remove(id: string): boolean
}

export function createAudioTracksRepository(db: DatabaseSync): AudioTracksRepository {
  const insert = db.prepare(`
    INSERT INTO audio_tracks (id, title_id, source_index, language, title, codec_origen, codec_salida, channels, status)
    VALUES (@id, @title_id, @source_index, @language, @title, @codec_origen, @codec_salida, @channels, @status)
  `)
  const selectById = db.prepare('SELECT * FROM audio_tracks WHERE id = ?')
  const selectByTitle = db.prepare('SELECT * FROM audio_tracks WHERE title_id = ? ORDER BY source_index')
  const deleteById = db.prepare('DELETE FROM audio_tracks WHERE id = ?')

  const get = (id: string): AudioTrack | undefined => asRow<AudioTrack>(selectById.get(id))

  return {
    create(input) {
      const id = input.id ?? newId()
      insert.run({
        id,
        title_id: input.title_id,
        source_index: input.source_index,
        language: input.language ?? null,
        title: input.title ?? null,
        codec_origen: input.codec_origen,
        codec_salida: input.codec_salida ?? null,
        channels: input.channels ?? null,
        status: input.status ?? 'pending'
      })
      return get(id)!
    },
    get,
    listByTitle: (titleId) => asRows<AudioTrack>(selectByTitle.all(titleId)),
    update(id, patch) {
      updateColumns(db, 'audio_tracks', id, patch, AUDIO_MUTABLE)
      return get(id)
    },
    remove: (id) => deleteById.run(id).changes > 0
  }
}

export function createSubtitleTracksRepository(db: DatabaseSync): SubtitleTracksRepository {
  const insert = db.prepare(`
    INSERT INTO subtitle_tracks (id, title_id, source_index, language, title, formato_origen, formato_salida, requiere_ocr, status)
    VALUES (@id, @title_id, @source_index, @language, @title, @formato_origen, @formato_salida, @requiere_ocr, @status)
  `)
  const selectById = db.prepare('SELECT * FROM subtitle_tracks WHERE id = ?')
  const selectByTitle = db.prepare('SELECT * FROM subtitle_tracks WHERE title_id = ? ORDER BY source_index')
  const deleteById = db.prepare('DELETE FROM subtitle_tracks WHERE id = ?')

  // SQLite has no boolean type: requiere_ocr travels as 0/1
  const fromRow = (row: unknown): SubtitleTrack | undefined => {
    if (!row) return undefined
    const raw = row as Omit<SubtitleTrack, 'requiere_ocr'> & { requiere_ocr: number }
    return { ...raw, requiere_ocr: raw.requiere_ocr === 1 }
  }
  const get = (id: string): SubtitleTrack | undefined => fromRow(selectById.get(id))

  return {
    create(input) {
      const id = input.id ?? newId()
      insert.run({
        id,
        title_id: input.title_id,
        source_index: input.source_index,
        language: input.language ?? null,
        title: input.title ?? null,
        formato_origen: input.formato_origen,
        formato_salida: input.formato_salida ?? null,
        requiere_ocr: input.requiere_ocr ? 1 : 0,
        status: input.status ?? 'pending'
      })
      return get(id)!
    },
    get,
    listByTitle: (titleId) => selectByTitle.all(titleId).map((row) => fromRow(row)!),
    update(id, patch) {
      updateColumns(db, 'subtitle_tracks', id, patch, SUBTITLE_MUTABLE)
      return get(id)
    },
    remove: (id) => deleteById.run(id).changes > 0
  }
}
