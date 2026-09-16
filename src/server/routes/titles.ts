import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type { Standard } from '@shared/config'
import type { ServerContext } from '../context'
import { HttpError, badRequest, notFound } from '../errors'
import type { ConfigOverrides } from '../jobs/config'
import { enqueueTitle } from '../jobs/enqueue'
import { saveUpload, uploadPath } from '../jobs/uploads'
import { readFolderTree } from '../jobs/folder-tree'

interface CreateTitleBody {
  sourcePath?: unknown
  name?: unknown
  standards?: unknown
  qualities?: unknown
  segmentDurationSeconds?: unknown
}

export const titlesRoutes: FastifyPluginAsync<{ context: ServerContext }> = async (app, { context }) => {
  const { repos, runner, events } = context

  // JSON: { sourcePath, name?, standards?, qualities?, segmentDurationSeconds? }
  // multipart: file part "file" plus the same fields as text parts (lists comma-separated)
  app.post('/titles', async (request, reply) => {
    const result = request.isMultipart() ? await createFromUpload(request) : await createFromPath(request)
    runner.notify()
    return reply.code(201).send(result)
  })

  async function createFromPath(request: FastifyRequest): Promise<Awaited<ReturnType<typeof enqueueTitle>>> {
    const body = (request.body ?? {}) as CreateTitleBody
    if (typeof body.sourcePath !== 'string' || body.sourcePath.length === 0) throw badRequest('sourcePath es obligatorio')
    return enqueueTitle(context, {
      sourcePath: body.sourcePath,
      name: optionalString(body.name, 'name'),
      overrides: parseOverrides(body)
    })
  }

  async function createFromUpload(request: FastifyRequest): Promise<Awaited<ReturnType<typeof enqueueTitle>>> {
    const config = repos.settings.getConfig()
    if (!config.outputFolder) throw new HttpError(409, 'Configura la carpeta de salida antes de subir archivos')

    const titleId = randomUUID()
    const fields: CreateTitleBody = {}
    let savedPath: string | undefined
    let originalName: string | undefined

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (savedPath) throw badRequest('Solo se admite un archivo por solicitud')
        originalName = part.filename
        savedPath = uploadPath(config.outputFolder, titleId, part.filename)
        await saveUpload(part.file, savedPath)
      } else {
        ;(fields as Record<string, unknown>)[part.fieldname] = part.value
      }
    }
    if (!savedPath) throw badRequest('Falta el archivo (campo "file")')

    try {
      return await enqueueTitle(context, {
        titleId,
        sourcePath: savedPath,
        sourceManaged: true,
        name: optionalString(fields.name, 'name') ?? originalName?.replace(/\.[^.]+$/, ''),
        overrides: parseOverrides(fields)
      })
    } catch (error) {
      await rm(savedPath, { force: true })
      throw error
    }
  }

  app.get('/titles', async () => repos.titles.list())

  app.get<{ Params: { id: string } }>('/titles/:id', async (request) => {
    const title = repos.titles.get(request.params.id)
    if (!title) throw notFound('Título no encontrado')
    return {
      ...title,
      renditions: repos.renditions.listByTitle(title.id),
      audio_tracks: repos.audioTracks.listByTitle(title.id),
      subtitle_tracks: repos.subtitleTracks.listByTitle(title.id),
      jobs: repos.jobs.listByTitle(title.id)
    }
  })

  app.get<{ Params: { id: string } }>('/titles/:id/files', async (request) => {
    const title = repos.titles.get(request.params.id)
    if (!title) throw notFound('Título no encontrado')
    return { root: title.output_folder, ...(await readFolderTree(title.output_folder)) }
  })

  // Removes the title, its output folder and (only) sources uploaded through the API
  app.delete<{ Params: { id: string } }>('/titles/:id', async (request, reply) => {
    const title = repos.titles.get(request.params.id)
    if (!title) throw notFound('Título no encontrado')

    await runner.cancelForTitle(title.id)
    await rm(title.output_folder, { recursive: true, force: true })
    if (title.source_managed) await rm(title.source_path, { force: true })
    repos.titles.remove(title.id)
    events.emit({ type: 'title.deleted', titleId: title.id })
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>('/titles/:id/reprocess', async (request) => {
    if (!repos.titles.get(request.params.id)) throw notFound('Título no encontrado')
    throw new HttpError(501, 'El reprocesado incremental se implementa en la fase 9')
  })
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw badRequest(`${field} debe ser texto`)
  return value
}

// Accepts JSON arrays/numbers and the comma-separated strings of multipart fields
function parseOverrides(body: CreateTitleBody): ConfigOverrides {
  const overrides: ConfigOverrides = {}
  const list = (value: unknown, field: string): string[] | undefined => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean)
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[]
    throw badRequest(`${field} debe ser una lista de textos`)
  }

  const standards = list(body.standards, 'standards')
  if (standards) overrides.standards = standards as Standard[]
  const qualities = list(body.qualities, 'qualities')
  if (qualities) overrides.qualities = qualities

  if (body.segmentDurationSeconds !== undefined && body.segmentDurationSeconds !== null && body.segmentDurationSeconds !== '') {
    const seconds = Number(body.segmentDurationSeconds)
    if (!Number.isFinite(seconds)) throw badRequest('segmentDurationSeconds debe ser un número')
    overrides.segmentDurationSeconds = seconds
  }
  return overrides
}
