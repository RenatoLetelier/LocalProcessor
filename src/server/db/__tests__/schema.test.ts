import { describe, expect, it } from 'vitest'
import { openDatabase } from '..'
import { runMigrations } from '../migrate'

function tableNames(db: ReturnType<typeof openDatabase>['db']): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name
  )
}

describe('schema', () => {
  it('creates every table of the ER diagram plus settings and schema_migrations', () => {
    const { db } = openDatabase(':memory:')
    expect(tableNames(db)).toEqual([
      'audio_tracks',
      'jobs',
      'renditions',
      'schema_migrations',
      'settings',
      'subtitle_tracks',
      'titles'
    ])
  })

  it('applies each migration only once', () => {
    const { db } = openDatabase(':memory:')
    expect(runMigrations(db)).toEqual([])
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
    expect(versions).toEqual([{ version: 1 }, { version: 2 }])
  })

  it('deletes renditions, tracks and jobs together with their title', () => {
    const { repos } = openDatabase(':memory:')
    const title = repos.titles.create({ name: 'Movie', source_path: 'C:/in/movie.mkv', output_folder: 'C:/out/x' })
    repos.renditions.create({ title_id: title.id, label: '720p', width: 1280, height: 720, bitrate: 3e6, video_codec: 'h264' })
    repos.audioTracks.create({ title_id: title.id, source_index: 1, codec_origen: 'dts' })
    repos.subtitleTracks.create({ title_id: title.id, source_index: 2, formato_origen: 'subrip' })
    repos.jobs.create({ title_id: title.id, tipo: 'inicial', config: {} })

    expect(repos.titles.remove(title.id)).toBe(true)

    expect(repos.renditions.listByTitle(title.id)).toEqual([])
    expect(repos.audioTracks.listByTitle(title.id)).toEqual([])
    expect(repos.subtitleTracks.listByTitle(title.id)).toEqual([])
    expect(repos.jobs.listByTitle(title.id)).toEqual([])
  })

  it('rejects status and tipo values outside the documented sets', () => {
    const { repos } = openDatabase(':memory:')
    const title = repos.titles.create({ name: 'Movie', source_path: 'C:/in/movie.mkv', output_folder: 'C:/out/x' })

    expect(() => repos.titles.update(title.id, { status: 'weird' as never })).toThrow(/CHECK/)
    expect(() => repos.jobs.create({ title_id: title.id, tipo: 'otro' as never, config: {} })).toThrow(/CHECK/)
  })

  it('does not allow two renditions with the same label for one title', () => {
    const { repos } = openDatabase(':memory:')
    const title = repos.titles.create({ name: 'Movie', source_path: 'C:/in/movie.mkv', output_folder: 'C:/out/x' })
    const rendition = { title_id: title.id, label: '1080p', width: 1920, height: 1080, bitrate: 6e6, video_codec: 'h264' }

    repos.renditions.create(rendition)
    expect(() => repos.renditions.create(rendition)).toThrow(/UNIQUE/)
  })

  it('round-trips subtitle requiere_ocr as a boolean', () => {
    const { repos } = openDatabase(':memory:')
    const title = repos.titles.create({ name: 'Movie', source_path: 'C:/in/movie.mkv', output_folder: 'C:/out/x' })
    const track = repos.subtitleTracks.create({
      title_id: title.id,
      source_index: 3,
      formato_origen: 'hdmv_pgs_subtitle',
      requiere_ocr: true
    })

    expect(track.requiere_ocr).toBe(true)
    expect(repos.subtitleTracks.update(track.id, { requiere_ocr: false })?.requiere_ocr).toBe(false)
  })

  it('updates only mutable columns and refreshes updated_at', () => {
    const { repos } = openDatabase(':memory:')
    const title = repos.titles.create({ name: 'Movie', source_path: 'C:/in/movie.mkv', output_folder: 'C:/out/x' })

    const updated = repos.titles.update(title.id, {
      status: 'processing',
      source_width: 1920,
      source_height: 800,
      // not a mutable column: must be ignored, not fail
      ...({ id: 'hack', created_at: 'never' } as object)
    })

    expect(updated).toBeDefined()
    expect(updated!.id).toBe(title.id)
    expect(updated!.created_at).toBe(title.created_at)
    expect(updated!.status).toBe('processing')
    expect(updated!.source_width).toBe(1920)
    expect(updated!.updated_at >= title.updated_at).toBe(true)
  })

  it('filters jobs by one or several statuses in creation order', () => {
    const { repos } = openDatabase(':memory:')
    const title = repos.titles.create({ name: 'Movie', source_path: 'C:/in/movie.mkv', output_folder: 'C:/out/x' })
    const a = repos.jobs.create({ title_id: title.id, tipo: 'inicial', config: { qualities: ['720p'] } })
    const b = repos.jobs.create({ title_id: title.id, tipo: 'agregar_calidad', config: {}, status: 'running' })
    repos.jobs.create({ title_id: title.id, tipo: 'agregar_pista', config: {}, status: 'done' })

    expect(repos.jobs.list({ status: 'queued' }).map((j) => j.id)).toEqual([a.id])
    expect(repos.jobs.list({ status: ['queued', 'running'] }).map((j) => j.id)).toEqual([a.id, b.id])
    expect(JSON.parse(a.config_json)).toEqual({ qualities: ['720p'] })
  })
})
