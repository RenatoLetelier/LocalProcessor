import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'

// Uploaded sources live on the output volume, next to the titles, because they
// must be kept for later reprocessing (adding a quality needs the original).
export const UPLOADS_DIR = '.uploads'

export function uploadPath(outputFolder: string, titleId: string, originalName: string): string {
  const ext = extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '')
  return join(outputFolder, UPLOADS_DIR, `${titleId}${ext}`)
}

export async function saveUpload(stream: Readable, destination: string): Promise<void> {
  await mkdir(join(destination, '..'), { recursive: true })
  try {
    await pipeline(stream, createWriteStream(destination))
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
}
