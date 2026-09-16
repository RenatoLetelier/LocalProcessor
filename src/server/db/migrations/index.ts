import * as initial from './001-initial'
import * as jobsAttempts from './002-jobs-attempts'

export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  { version: 1, ...initial },
  { version: 2, ...jobsAttempts }
]
