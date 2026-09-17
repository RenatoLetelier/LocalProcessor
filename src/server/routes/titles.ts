import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import type { Standard } from '@shared/config'
import type { ServerContext } from '../context'
import { HttpError, badRequest, notFound } from '../errors'
import type { ConfigOverrides } from '../jobs/config'
import { enqueueTitle } from '../jobs/enqueue'
import { importOutputFolder } from '../jobs/import'
import { linkSource } from '../jobs/link-source'
import { saveUpload, uploadPath } from '../jobs/uploads'
import { readFolderTree } from '../jobs/folder-tree'
import { enqueueReprocess, type ReprocessRequest } from '../jobs/reprocess'

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

  // Rebuilds the library from the output folder (titles published earlier, moved folders)
  app.post('/titles/import', async () => {
    const { outputFolder } = repos.settings.getConfig()
    if (!outputFolder) throw new HttpError(409, 'Configura la carpeta de salida antes de importar')
    if (!(await stat(outputFolder).catch(() => undefined))?.isDirectory()) throw new HttpError(409, `La carpeta de salida no existe: ${outputFolder}`)
    return importOutputFolder({ db: context.db, repos, events }, outputFolder)
  })

  // Attaches the source file to a title (imported titles have none until then)
  app.put<{ Params: { id: string }; Body: { sourcePath: string } }>(
    '/titles/:id/source',
    { schema: { body: { type: 'object', required: ['sourcePath'], additionalProperties: false, properties: { sourcePath: { type: 'string', minLength: 1 } } } } },
    async (request) => linkSource(context, request.params.id, request.body.sourcePath)
  )

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
    if (title.source_managed && title.source_path) await rm(title.source_path, { force: true })
    repos.titles.remove(title.id)
    events.emit({ type: 'title.deleted', titleId: title.id })
    return reply.code(204).send()
  })

  // { tipo: 'agregar_calidad', qualities } | { tipo: 'agregar_pista', audio?, subtitles?, files? } |
  // { tipo: 'reprocesar_completo', standards?, qualities?, segmentDurationSeconds? }
  app.post<{ Params: { id: string }; Body: ReprocessRequest }>(
    '/titles/:id/reprocess',
    { schema: { body: reprocessSchema } },
    async (request, reply) => {
      const result = await enqueueReprocess(context, request.params.id, request.body)
      runner.notify()
      return reply.code(202).send(result)
    }
  )
}

const reprocessSchema = {
  type: 'object',
  required: ['tipo'],
  additionalProperties: false,
  properties: {
    tipo: { type: 'string', enum: ['agregar_calidad', 'agregar_pista', 'reprocesar_completo'] },
    qualities: { type: 'array', items: { type: 'string' } },
    audio: { type: 'array', items: { type: 'integer' } },
    subtitles: { type: 'array', items: { type: 'integer' } },
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'kind'],
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          kind: { type: 'string', enum: ['audio', 'subtitle'] },
          language: { type: 'string' },
          name: { type: 'string' },
          forced: { type: 'boolean' }
        }
      }
    },
    standards: { type: 'array', items: { type: 'string', enum: ['hls', 'dash'] } },
    segmentDurationSeconds: { type: 'integer' }
  }
} as const

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
