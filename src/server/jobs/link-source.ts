import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Title } from '@shared/model'
import { ProbeError, probeSource } from '@pipeline/probe'
import { ProcessError } from '@pipeline/exec'
import type { Binaries } from '@pipeline/types'
import type { Repositories } from '../db/repositories'
import { badRequest, conflict, notFound } from '../errors'
import { sourceFields, type Prober } from './enqueue'
import type { ServerEvents } from './events'
import { sourceHash } from './source-hash'

export interface LinkSourceDeps {
  repos: Repositories
  events: ServerEvents
  binaries: Binaries
  probe?: Prober
}

// Longer than any container/stream rounding, shorter than a different cut of the film
const DURATION_TOLERANCE = (seconds: number): number => Math.max(2, seconds * 0.01)

// PUT /titles/:id/source: attaches (or replaces) the source file of a title, which
// imported titles lack. The file must look like the same movie: same duration
// within tolerance. Reprocessing is possible again afterwards.
export async function linkSource(deps: LinkSourceDeps, titleId: string, sourcePath: string): Promise<Title> {
  const { repos, events } = deps
  const title = repos.titles.get(titleId)
  if (!title) throw notFound('Título no encontrado')

  const active = repos.jobs.listByTitle(title.id).some((j) => j.status === 'queued' || j.status === 'running')
  if (active || title.status === 'processing') throw conflict('El título tiene un job en curso o en cola')

  if (!isAbsolute(sourcePath)) throw badRequest('sourcePath debe ser una ruta absoluta')
  const info = await stat(sourcePath).catch(() => undefined)
  if (!info) throw badRequest(`El archivo no existe: ${sourcePath}`)
  if (!info.isFile()) throw badRequest(`La ruta no es un archivo: ${sourcePath}`)

  const other = repos.titles.findBySourcePath(sourcePath)
  if (other && other.id !== title.id) throw conflict(`El archivo ya es el origen del título ${other.id}`, { titleId: other.id })

  const probe = deps.probe ?? probeSource
  const source = await probe(deps.binaries, sourcePath).catch((error: unknown) => {
    if (error instanceof ProbeError || error instanceof ProcessError) throw badRequest(`No se pudo analizar el archivo: ${error.message}`)
    throw error
  })
  if (title.duration_seconds && Math.abs(source.durationSeconds - title.duration_seconds) > DURATION_TOLERANCE(title.duration_seconds)) {
    throw badRequest(
      `La duración no coincide: el archivo dura ${formatDuration(source.durationSeconds)} y el título ${formatDuration(title.duration_seconds)}`
    )
  }

  const updated = repos.titles.update(title.id, {
    source_path: sourcePath,
    source_managed: false,
    source_hash: await sourceHash(sourcePath),
    ...sourceFields(source)
  })!
  events.emit({ type: 'title.updated', title: updated })
  return updated
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
