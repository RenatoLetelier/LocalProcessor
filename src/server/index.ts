import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import type { ServerContext } from './context'
import { HttpError } from './errors'
import { healthRoutes } from './routes/health'
import { configRoutes } from './routes/config'
import { titlesRoutes } from './routes/titles'
import { jobsRoutes } from './routes/jobs'

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

  await app.register(cors, { origin: opts.allowedOrigins })
  // Movies are large: no per-file size limit, one file per request
  await app.register(multipart, { limits: { fileSize: Number.MAX_SAFE_INTEGER, files: 1 } })
  await app.register(websocket)

  await app.register(healthRoutes, { version: opts.version })
  await app.register(configRoutes, { repos: opts.context.repos })
  await app.register(titlesRoutes, { context: opts.context })
  await app.register(jobsRoutes, { context: opts.context, allowedOrigins: opts.allowedOrigins })

  return app
}

export async function startServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = await createServer(opts)
  await app.listen({ host: opts.host, port: opts.port })
  return app
}
