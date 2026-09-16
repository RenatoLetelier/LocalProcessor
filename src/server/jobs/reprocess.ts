import { stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import type { Job, JobTipo, Title } from '@shared/model'
import type { Standard } from '@shared/config'
import { toBcp47 } from '@pipeline/lang'
import { wouldUpscale } from '@pipeline/plan'
import { probeTrackFile, type TrackFileInfo } from '@pipeline/probe'
import type { Binaries, ExternalTrack } from '@pipeline/types'
import type { Repositories } from '../db/repositories'
import { badRequest, conflict, notFound } from '../errors'
import { snapshotJobConfig, type ConfigOverrides, type JobConfig } from './config'
import type { ServerEvents } from './events'

export interface ExternalFileRequest {
  path: string
  kind: 'audio' | 'subtitle'
  language?: string
  name?: string
  forced?: boolean
}

export interface ReprocessRequest {
  tipo: Exclude<JobTipo, 'inicial'>
  // agregar_calidad: labels to add; reprocesar_completo: ladder override
  qualities?: string[]
  // agregar_pista: source tracks to retry (by source_index) and external files to add
  audio?: number[]
  subtitles?: number[]
  files?: ExternalFileRequest[]
  // reprocesar_completo overrides
  standards?: Standard[]
  segmentDurationSeconds?: number
}

export interface ReprocessDeps {
  repos: Repositories
  events: ServerEvents
  binaries: Binaries
  probeTracks?: (binaries: Binaries, path: string) => Promise<TrackFileInfo>
}

// POST /titles/:id/reprocess without the HTTP. Validates against the DB state and
// creates the job; what actually exists on disk is re-checked when the job runs.
export async function enqueueReprocess(deps: ReprocessDeps, titleId: string, request: ReprocessRequest): Promise<{ title: Title; job: Job }> {
  const { repos, events } = deps
  const title = repos.titles.get(titleId)
  if (!title) throw notFound('Título no encontrado')

  const active = repos.jobs.listByTitle(title.id).some((j) => j.status === 'queued' || j.status === 'running')
  if (active || title.status === 'processing') throw conflict('El título ya tiene un job en curso o en cola')
  if (!(await stat(title.source_path).catch(() => undefined))?.isFile()) {
    throw badRequest(`El archivo de origen ya no existe: ${title.source_path}`)
  }

  const global = repos.settings.getConfig()
  const published = repos.renditions.listByTitle(title.id).some((r) => r.status === 'done')
  if (request.tipo !== 'reprocesar_completo' && !published) {
    throw conflict('El título no tiene calidades publicadas; usa el reprocesado completo')
  }
  let config: JobConfig & { externalTracks?: ExternalTrack[]; audioIndexes?: number[]; subtitleIndexes?: number[] }

  switch (request.tipo) {
    case 'agregar_calidad':
      config = { ...snapshotJobConfig(global), qualities: validateQualities(repos, title, global.rungs, request.qualities) }
      break
    case 'agregar_pista':
      config = { ...snapshotJobConfig(global), ...(await validateTracks(deps, title, request)) }
      break
    case 'reprocesar_completo': {
      const overrides: ConfigOverrides = {}
      if (request.standards) overrides.standards = request.standards
      if (request.qualities) overrides.qualities = request.qualities
      if (request.segmentDurationSeconds !== undefined) overrides.segmentDurationSeconds = request.segmentDurationSeconds
      config = { ...snapshotJobConfig(global, overrides), externalTracks: externalTracksOf(repos, title.id) }
      break
    }
    default:
      throw badRequest(`Tipo de reprocesado desconocido: ${String(request.tipo)}`)
  }

  const job = repos.jobs.create({ title_id: title.id, tipo: request.tipo, config })
  const updated = repos.titles.update(title.id, { status: 'queued', error: null })!
  events.emit({ type: 'title.updated', title: updated })
  events.emit({ type: 'job.updated', job })
  return { title: updated, job }
}

function validateQualities(repos: Repositories, title: Title, rungs: JobConfig['rungs'], labels: string[] | undefined): string[] {
  if (!labels || labels.length === 0) throw badRequest('qualities: indica al menos una calidad a agregar')
  const existing = new Set(repos.renditions.listByTitle(title.id).filter((r) => r.status === 'done').map((r) => r.label))
  const problems: string[] = []
  for (const label of labels) {
    const rung = rungs[label]
    if (!rung) problems.push(`${label}: no está definida en la configuración`)
    else if (existing.has(label)) problems.push(`${label}: ya existe en el título`)
    else if (title.source_width && title.source_height && wouldUpscale(title.source_width, title.source_height, rung)) {
      problems.push(`${label}: el origen (${title.source_width}×${title.source_height}) es menor que ${rung.width}×${rung.height}, sería upscaling`)
    }
  }
  if (problems.length > 0) throw badRequest(`No se puede agregar: ${problems.join('; ')}`, { problems })
  return [...new Set(labels)]
}

async function validateTracks(
  deps: ReprocessDeps,
  title: Title,
  request: ReprocessRequest
): Promise<{ audioIndexes: number[]; subtitleIndexes: number[]; externalTracks: ExternalTrack[] }> {
  const { repos } = deps
  const problems: string[] = []
  const audioRows = repos.audioTracks.listByTitle(title.id)
  const subtitleRows = repos.subtitleTracks.listByTitle(title.id)

  const audioIndexes = [...new Set(request.audio ?? [])]
  for (const index of audioIndexes) {
    // One row per output codec (Dolby copy + AAC companion share the index)
    const rows = audioRows.filter((a) => a.source_index === index)
    if (rows.length === 0) problems.push(`audio ${index}: no existe en el título`)
    else if (rows.every((row) => row.status === 'done')) problems.push(`audio ${index}: ya está incluido`)
  }

  const subtitleIndexes = [...new Set(request.subtitles ?? [])]
  for (const index of subtitleIndexes) {
    const row = subtitleRows.find((s) => s.source_index === index)
    if (!row) problems.push(`subtítulo ${index}: no existe en el título`)
    else if (row.status === 'done') problems.push(`subtítulo ${index}: ya está incluido`)
    else if (row.requiere_ocr) problems.push(`subtítulo ${index}: es de imagen, requiere OCR (no soportado)`)
  }

  const externalTracks: ExternalTrack[] = []
  let nextAudio = Math.min(0, ...audioRows.map((a) => a.source_index)) - 1
  let nextSubtitle = Math.min(0, ...subtitleRows.map((s) => s.source_index)) - 1
  const probe = deps.probeTracks ?? probeTrackFile

  for (const file of request.files ?? []) {
    if (!isAbsolute(file.path) || !(await stat(file.path).catch(() => undefined))?.isFile()) {
      problems.push(`archivo no encontrado: ${file.path}`)
      continue
    }
    if ([...audioRows, ...subtitleRows].some((row) => row.source_path === file.path)) {
      problems.push(`archivo ya agregado a este título: ${file.path}`)
      continue
    }
    const info = await probe(deps.binaries, file.path).catch(() => null)
    const stream = file.kind === 'audio' ? info?.audio[0] : info?.subtitles[0]
    if (!stream) {
      problems.push(`${file.path}: no contiene ${file.kind === 'audio' ? 'audio' : 'subtítulos'}`)
      continue
    }
    const language = toBcp47(file.language ?? stream.language)
    const name = file.name?.trim() || null
    if (file.kind === 'audio') {
      const sourceIndex = nextAudio--
      repos.audioTracks.create({
        title_id: title.id,
        source_index: sourceIndex,
        source_path: file.path,
        language,
        title: name,
        codec_origen: stream.codec,
        channels: 'channels' in stream ? stream.channels : null,
        status: 'pending'
      })
      externalTracks.push({ kind: 'audio', sourceIndex, path: file.path, language, name })
    } else {
      const sourceIndex = nextSubtitle--
      repos.subtitleTracks.create({
        title_id: title.id,
        source_index: sourceIndex,
        source_path: file.path,
        language,
        title: name ?? basename(file.path, extname(file.path)),
        formato_origen: stream.codec,
        requiere_ocr: 'isImage' in stream ? stream.isImage : false,
        status: 'pending'
      })
      externalTracks.push({ kind: 'subtitle', sourceIndex, path: file.path, language, name, forced: file.forced ?? false })
    }
  }

  if (problems.length > 0) throw badRequest(`No se puede agregar: ${problems.join('; ')}`, { problems })
  if (audioIndexes.length + subtitleIndexes.length + externalTracks.length === 0) {
    throw badRequest('Indica al menos una pista a agregar (audio, subtitles o files)')
  }
  return { audioIndexes, subtitleIndexes, externalTracks }
}

// External tracks already registered for the title, replayed by a full reprocess
export function externalTracksOf(repos: Repositories, titleId: string): ExternalTrack[] {
  const audio = repos.audioTracks
    .listByTitle(titleId)
    .filter((a) => a.source_path)
    .map<ExternalTrack>((a) => ({ kind: 'audio', sourceIndex: a.source_index, path: a.source_path!, language: a.language, name: a.title }))
  const subtitles = repos.subtitleTracks
    .listByTitle(titleId)
    .filter((s) => s.source_path)
    .map<ExternalTrack>((s) => ({ kind: 'subtitle', sourceIndex: s.source_index, path: s.source_path!, language: s.language, name: s.title }))
  return [...audio, ...subtitles]
}
