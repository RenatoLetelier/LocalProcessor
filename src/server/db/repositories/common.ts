import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

export const now = (): string => new Date().toISOString()
export const newId = (): string => randomUUID()

export type Bindable = Record<string, SQLInputValue>

// node:sqlite types rows as Record<string, SQLOutputValue>; the schema guarantees the shape
export const asRow = <T>(row: unknown): T | undefined => row as T | undefined
export const asRows = <T>(rows: unknown[]): T[] => rows as T[]

// Builds and runs a partial UPDATE from `patch`, ignoring keys outside `columns`
export function updateColumns(
  db: DatabaseSync,
  table: string,
  id: string,
  patch: Record<string, unknown>,
  columns: readonly string[]
): boolean {
  const entries = Object.entries(patch).filter(([key, value]) => columns.includes(key) && value !== undefined)
  if (entries.length === 0) return false

  const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ')
  const params: Bindable = { id }
  for (const [key, value] of entries) params[key] = toSqlValue(value)

  const result = db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = @id`).run(params)
  return result.changes > 0
}

export function toSqlValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return value as SQLInputValue
}
