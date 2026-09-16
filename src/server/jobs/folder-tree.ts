import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Explorer view of a published title. Media segments are collapsed into one
// synthetic entry per folder: a feature film has thousands of them.
export interface FolderEntry {
  name: string
  kind: 'dir' | 'file' | 'segments'
  sizeBytes: number
  fileCount: number
  children?: FolderEntry[]
}

export interface FolderTree {
  exists: boolean
  totalBytes: number
  fileCount: number
  entries: FolderEntry[]
}

const SEGMENT_EXTENSION = '.m4s'

export async function readFolderTree(root: string): Promise<FolderTree> {
  const info = await stat(root).catch(() => undefined)
  if (!info?.isDirectory()) return { exists: false, totalBytes: 0, fileCount: 0, entries: [] }

  const entries = await readEntries(root)
  return {
    exists: true,
    totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
    fileCount: entries.reduce((sum, e) => sum + e.fileCount, 0),
    entries
  }
}

async function readEntries(dir: string): Promise<FolderEntry[]> {
  const names = await readdir(dir, { withFileTypes: true })
  const entries: FolderEntry[] = []
  const segments = { count: 0, bytes: 0 }

  for (const dirent of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, dirent.name)
    if (dirent.isDirectory()) {
      const children = await readEntries(path)
      entries.push({
        name: dirent.name,
        kind: 'dir',
        sizeBytes: children.reduce((sum, e) => sum + e.sizeBytes, 0),
        fileCount: children.reduce((sum, e) => sum + e.fileCount, 0),
        children
      })
      continue
    }
    const { size } = await stat(path)
    if (dirent.name.endsWith(SEGMENT_EXTENSION)) {
      segments.count++
      segments.bytes += size
    } else {
      entries.push({ name: dirent.name, kind: 'file', sizeBytes: size, fileCount: 1 })
    }
  }

  if (segments.count > 0) {
    entries.push({ name: `seg_*${SEGMENT_EXTENSION}`, kind: 'segments', sizeBytes: segments.bytes, fileCount: segments.count })
  }
  return entries
}
