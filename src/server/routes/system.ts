import type { FastifyPluginAsync } from 'fastify'
import type { ServerContext } from '../context'
import { computeConcurrency, resolveEncoder } from '../jobs/concurrency'

// Hardware detected at startup and the concurrency it yields with the current config
export const systemRoutes: FastifyPluginAsync<{ context: ServerContext }> = async (app, { context }) => {
  app.get('/system', async () => {
    const config = context.repos.settings.getConfig()
    const hardware = context.hardware ?? null
    return {
      platform: hardware?.platform ?? process.platform,
      cpuThreads: hardware?.cpuThreads ?? 0,
      encoders: hardware?.encoders ?? [],
      selectedEncoder: resolveEncoder(config.encoder, hardware),
      concurrency: computeConcurrency(config, hardware)
    }
  })
}
