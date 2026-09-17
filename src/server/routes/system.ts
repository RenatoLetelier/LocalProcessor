import type { FastifyPluginAsync } from 'fastify'
import { networkInterfaces } from 'node:os'
import type { ServerContext } from '../context'
import { computeConcurrency, resolveEncoder } from '../jobs/concurrency'

// Hardware detected at startup, the concurrency it yields with the current
// config, and where the API is reachable
export const systemRoutes: FastifyPluginAsync<{ context: ServerContext }> = async (app, { context }) => {
  app.get('/system', async () => {
    const config = context.repos.settings.getConfig()
    const hardware = context.hardware ?? null
    const address = app.server.address()
    return {
      platform: hardware?.platform ?? process.platform,
      cpuThreads: hardware?.cpuThreads ?? 0,
      encoders: hardware?.encoders ?? [],
      selectedEncoder: resolveEncoder(config.encoder, hardware),
      concurrency: computeConcurrency(config, hardware),
      listening: address && typeof address === 'object' ? { host: address.address, port: address.port } : null,
      lanAddresses: lanAddresses()
    }
  })
}

// IPv4 addresses other machines can use, skipping loopback and link-local (169.254.x)
export function lanAddresses(): string[] {
  const found: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue
      found.push(entry.address)
    }
  }
  return found.sort()
}
