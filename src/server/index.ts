import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { Repositories } from './db/repositories'
import { healthRoutes } from './routes/health'
import { configRoutes } from './routes/config'

export interface ServerOptions {
  host: string
  port: number
  version: string
  repos: Repositories
  // Browser origins allowed to call the API (the Electron renderer). Non-browser
  // clients (curl, Node) send no Origin header and are unaffected by CORS.
  allowedOrigins: string[]
  logLevel?: string
}

export async function createServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: opts.logLevel ?? 'info' },
    // Reject unknown body keys instead of silently dropping them (Fastify default)
    ajv: { customOptions: { removeAdditional: false } }
  })

  await app.register(cors, { origin: opts.allowedOrigins })
  await app.register(healthRoutes, { version: opts.version })
  await app.register(configRoutes, { repos: opts.repos })

  return app
}

export async function startServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = await createServer(opts)
  await app.listen({ host: opts.host, port: opts.port })
  return app
}
