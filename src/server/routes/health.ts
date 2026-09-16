import type { FastifyPluginAsync } from 'fastify'
import { APP_NAME } from '@shared/constants'
import type { HealthResponse } from '@shared/api'

export const healthRoutes: FastifyPluginAsync<{ version: string }> = async (app, { version }) => {
  const startedAt = Date.now()

  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    app: APP_NAME,
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
  }))
}
