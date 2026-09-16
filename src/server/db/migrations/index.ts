import * as initial from './001-initial'

export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [{ version: 1, ...initial }]
