import type { FastifyPluginAsync } from 'fastify'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { AppConfig } from '@shared/config'
import { SEGMENT_DURATION_RANGE, validateConfig } from '@shared/config-validate'
import type { Repositories } from '../db/repositories'
import type { ServerEvents } from '../jobs/events'

const rungSchema = {
  type: 'object',
  required: ['width', 'height', 'maxBitrateKbps'],
  additionalProperties: false,
  properties: {
    width: { type: 'integer' },
    height: { type: 'integer' },
    maxBitrateKbps: { type: 'integer' }
  }
} as const

const configPatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outputFolder: { type: ['string', 'null'] },
    standards: { type: 'array', items: { type: 'string' } },
    qualities: { type: 'array', items: { type: 'string' } },
    rungs: {
      type: 'object',
      propertyNames: { pattern: '^[a-z0-9]+$' },
      additionalProperties: rungSchema
    },
    segmentDurationSeconds: { type: 'integer', minimum: SEGMENT_DURATION_RANGE.min, maximum: SEGMENT_DURATION_RANGE.max }
  }
} as const

export const configRoutes: FastifyPluginAsync<{ repos: Repositories; events?: ServerEvents }> = async (app, { repos, events }) => {
  app.get('/config', async (): Promise<AppConfig> => repos.settings.getConfig())

  app.put<{ Body: Partial<AppConfig> }>('/config', { schema: { body: configPatchSchema } }, async (request, reply) => {
    const patch = request.body
    const merged: AppConfig = { ...repos.settings.getConfig(), ...patch }

    const problems = validateConfig(merged)
    if (typeof patch.outputFolder === 'string') problems.push(...(await checkOutputFolder(patch.outputFolder)))

    if (problems.length > 0) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Configuración inválida: ${problems.join('; ')}`,
        problems
      })
    }

    const updated = repos.settings.updateConfig(patch)
    events?.emit({ type: 'config.updated', config: updated })
    return updated
  })
}

async function checkOutputFolder(folder: string): Promise<string[]> {
  if (!isAbsolute(folder)) return ['outputFolder: debe ser una ruta absoluta']
  try {
    const info = await stat(folder)
    return info.isDirectory() ? [] : ['outputFolder: la ruta no es una carpeta']
  } catch {
    return ['outputFolder: la carpeta no existe']
  }
}
