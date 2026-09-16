import type { Binaries } from '@pipeline/types'
import type { Repositories } from './db/repositories'
import type { Prober } from './jobs/enqueue'
import type { ServerEvents } from './jobs/events'
import type { JobRunner } from './jobs/runner'

// Everything the routes need, built once by the host (Electron main or tests)
export interface ServerContext {
  repos: Repositories
  events: ServerEvents
  runner: JobRunner
  binaries: Binaries
  probe?: Prober
  checkDiskSpace?: boolean
}
