import type { DatabaseSync } from 'node:sqlite'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { ImportSummary } from '@shared/api'
import type { Title } from '@shared/model'
import { METADATA_FILE } from '@pipeline/layout'
import type { MetadataAudioTrack, MetadataSubtitleTrack, TitleMetadata } from '@pipeline/types'
import type { Repositories } from '../db/repositories'
import { withTransaction } from '../db/transaction'
import type { ServerEvents } from './events'
import { sourceHash } from './source-hash'

export interface ImportDeps {
  db: DatabaseSync
  repos: Repositories
  events: ServerEvents
}

const TITLE_FOLDER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TRACK_ID = /^(e?)(\d+)_/

// metadata.json files written before the source block and the per-track source
// fields existed are still importable: the track ids carry the source index
type StoredMetadata = Omit<TitleMetadata, 'source' | 'dynamicRange' | 'audioTracks' | 'subtitleTracks'> & {
  source?: TitleMetadata['source']
  dynamicRange?: TitleMetadata['dynamicRange']
  audioTracks: (Omit<MetadataAudioTrack, 'sourceIndex' | 'sourceCodec'> & Partial<Pick<MetadataAudioTrack, 'sourceIndex' | 'sourceCodec'>>)[]
  subtitleTracks: (Omit<MetadataSubtitleTrack, 'sourceIndex' | 'sourceFormat'> & Partial<Pick<MetadataSubtitleTrack, 'sourceIndex' | 'sourceFormat'>>)[]
}

// Rebuilds the library from what the output folder holds: every <uuid>/ with a
// valid metadata.json becomes a title (or gets its folder re-pointed when the
// title exists but its recorded folder is gone). Nothing on disk is touched.
export async function importOutputFolder(deps: ImportDeps, folder: string): Promise<ImportSummary> {
  const { repos, events } = deps
  const summary: ImportSummary = { imported: [], relinked: [], skipped: [] }

  const entries = (await readdir(folder, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(folder, entry.name)
    if (!TITLE_FOLDER.test(entry.name)) {
      summary.skipped.push({ folder: entry.name, reason: 'el nombre no es un identificador de título' })
      continue
    }
    const read = await readTitleFolder(dir, entry.name)
    if ('reason' in read) {
      summary.skipped.push({ folder: entry.name, reason: read.reason })
      continue
    }

    const existing = repos.titles.get(entry.name)
    if (existing) {
      if (samePath(existing.output_folder, dir)) continue
      if (await isDirectory(existing.output_folder)) {
        summary.skipped.push({ folder: entry.name, reason: `ya está en la biblioteca con otra carpeta: ${existing.output_folder}` })
        continue
      }
      const relinked = repos.titles.update(existing.id, { output_folder: dir })!
      events.emit({ type: 'title.updated', title: relinked })
      summary.relinked.push(relinked)
      continue
    }

    const title = await createFromMetadata(deps, dir, read.metadata)
    events.emit({ type: 'title.updated', title })
    summary.imported.push(title)
  }
  return summary
}

async function readTitleFolder(dir: string, id: string): Promise<{ metadata: StoredMetadata } | { reason: string }> {
  let text: string
  try {
    text = await readFile(join(dir, METADATA_FILE), 'utf8')
  } catch {
    return { reason: `sin ${METADATA_FILE}` }
  }
  let metadata: StoredMetadata
  try {
    metadata = JSON.parse(text) as StoredMetadata
  } catch {
    return { reason: `${METADATA_FILE} ilegible` }
  }
  if (metadata.schemaVersion !== 1) return { reason: `versión de ${METADATA_FILE} no soportada (${String(metadata.schemaVersion)})` }
  if (metadata.titleId !== id) return { reason: `el titleId de ${METADATA_FILE} (${String(metadata.titleId)}) no coincide con la carpeta` }
  if (typeof metadata.name !== 'string' || !Array.isArray(metadata.renditions) || !Array.isArray(metadata.audioTracks) || !Array.isArray(metadata.subtitleTracks)) {
    return { reason: `${METADATA_FILE} incompleto` }
  }
  if (metadata.renditions.length === 0) return { reason: 'sin calidades publicadas' }

  const manifests = Object.values(metadata.manifests ?? {})
  if (manifests.length === 0) return { reason: 'sin manifiestos' }
  for (const file of manifests) {
    if (!(await isFile(join(dir, file)))) return { reason: `falta el manifiesto ${file}` }
  }
  for (const rendition of metadata.renditions) {
    if (!(await isDirectory(join(dir, rendition.path)))) return { reason: `falta la carpeta ${rendition.path}` }
  }
  for (const track of [...metadata.audioTracks, ...metadata.subtitleTracks]) {
    if (track.sourceIndex === undefined && indexFromTrackId(track.id) === null) return { reason: `identificador de pista inválido: ${track.id}` }
  }
  return { metadata }
}

async function createFromMetadata(deps: ImportDeps, dir: string, metadata: StoredMetadata): Promise<Title> {
  const { db, repos } = deps
  const id = metadata.titleId
  const source = metadata.source
  const range = metadata.dynamicRange?.source

  const title = withTransaction(db, () => {
    repos.titles.create({ id, name: metadata.name, source_path: source?.path ?? null, output_folder: dir, status: 'done' })
    for (const r of metadata.renditions) {
      repos.renditions.create({ title_id: id, label: r.label, width: r.width, height: r.height, bitrate: r.bitrate, video_codec: r.codec, status: 'done' })
    }
    for (const a of metadata.audioTracks) {
      repos.audioTracks.create({
        title_id: id,
        source_index: a.sourceIndex ?? indexFromTrackId(a.id)!,
        language: a.language,
        codec_origen: a.sourceCodec ?? a.codec,
        codec_salida: a.codec,
        channels: a.channels,
        status: 'done'
      })
    }
    for (const s of metadata.subtitleTracks) {
      repos.subtitleTracks.create({
        title_id: id,
        source_index: s.sourceIndex ?? indexFromTrackId(s.id)!,
        language: s.language,
        formato_origen: s.sourceFormat ?? s.format,
        formato_salida: s.format,
        status: 'done'
      })
    }
    return repos.titles.update(id, {
      duration_seconds: metadata.durationSeconds ?? null,
      source_width: source?.width ?? null,
      source_height: source?.height ?? null,
      source_fps: source?.fps ?? null,
      source_video_codec: source?.codec ?? null,
      source_video_bitrate: source?.bitrate ?? null,
      source_hdr: range && range !== 'sdr' ? range : null
    })!
  })

  // The fingerprint guards incremental jobs against a replaced source; only worth it when the file is there
  if (source?.path && (await isFile(source.path))) {
    return repos.titles.update(id, { source_hash: await sourceHash(source.path) })!
  }
  return title
}

// Track ids start with the source index: "3_es_aac", "e1_fr" (e = external, negative index)
export function indexFromTrackId(id: string): number | null {
  const match = TRACK_ID.exec(id)
  if (!match) return null
  const index = Number(match[2])
  return match[1] ? -index : index
}

function samePath(a: string, b: string): boolean {
  return relative(a, b) === ''
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() ?? false
}
