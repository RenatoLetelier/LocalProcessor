import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import type { ServerContext } from './context'
import { checkAccess } from './auth'
import { HttpError } from './errors'
import { healthRoutes } from './routes/health'
import { configRoutes } from './routes/config'
import { titlesRoutes } from './routes/titles'
import { jobsRoutes } from './routes/jobs'
import { systemRoutes } from './routes/system'

export type { ServerContext } from './context'

export interface ServerOptions {
  host: string
  port: number
  version: string
  context: ServerContext
  // Browser origins allowed to call the API (the Electron renderer). Non-browser
  // clients (curl, Node) send no Origin header and are unaffected by CORS.
  allowedOrigins: string[]
  logLevel?: string
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  501: 'Not Implemented'
}

export async function createServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: opts.logLevel ?? 'info' },
    // Reject unknown body keys instead of silently dropping them (Fastify default)
    ajv: { customOptions: { removeAdditional: false } }
  })

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .code(error.statusCode)
        .send({ statusCode: error.statusCode, error: STATUS_TEXT[error.statusCode] ?? 'Error', message: error.message, ...error.extra })
    }
    const fastifyError = error as FastifyError
    if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
      return reply
        .code(fastifyError.statusCode)
        .send({ statusCode: fastifyError.statusCode, error: fastifyError.name, message: fastifyError.message })
    }
    request.log.error(error)
    const message = error instanceof Error ? error.message : String(error)
    return reply.code(500).send({ statusCode: 500, error: 'Internal Server Error', message })
  })

  // @fastify/cors v11 only preflights GET/HEAD/POST by default; the UI also uses PUT and DELETE
  await app.register(cors, { origin: opts.allowedOrigins, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'] })
  // Movies are large: no per-file size limit, one file per request
  await app.register(multipart, { limits: { fileSize: Number.MAX_SAFE_INTEGER, files: 1 } })
  await app.register(websocket)

  // Non-loopback callers exist only while LAN access is enabled, and must present the token
  app.addHook('onRequest', async (request, reply) => {
    const header = (name: string): string | undefined => {
      const value = request.headers[name]
      return Array.isArray(value) ? value[0] : value
    }
    const decision = checkAccess(
      {
        ip: request.ip,
        method: request.method,
        authorization: header('authorization'),
        apiKey: header('x-api-key'),
        upgrade: header('upgrade'),
        queryToken: stringParam((request.query as Record<string, unknown> | undefined)?.token)
      },
      opts.context.repos.settings.getConfig()
    )
    if (!decision.ok) {
      return reply
        .code(decision.statusCode)
        .send({ statusCode: decision.statusCode, error: STATUS_TEXT[decision.statusCode], message: decision.message })
    }
  })

  await app.register(healthRoutes, { version: opts.version })
  await app.register(configRoutes, { repos: opts.context.repos, events: opts.context.events })
  await app.register(titlesRoutes, { context: opts.context })
  await app.register(jobsRoutes, { context: opts.context, allowedOrigins: opts.allowedOrigins })
  await app.register(systemRoutes, { context: opts.context })

  return app
}

export async function startServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = await createServer(opts)
  await app.listen({ host: opts.host, port: opts.port })
  return app
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
