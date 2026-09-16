import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readFolderTree } from '../folder-tree'

const root = mkdtempSync(join(tmpdir(), 'lp-tree-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('readFolderTree', () => {
  it('collapses media segments per folder and aggregates sizes upwards', async () => {
    mkdirSync(join(root, 'video', '720p'), { recursive: true })
    writeFileSync(join(root, 'master.m3u8'), 'x'.repeat(10))
    writeFileSync(join(root, 'video', '720p', 'init.mp4'), 'x'.repeat(100))
    writeFileSync(join(root, 'video', '720p', 'seg_00001.m4s'), 'x'.repeat(1000))
    writeFileSync(join(root, 'video', '720p', 'seg_00002.m4s'), 'x'.repeat(2000))

    const tree = await readFolderTree(root)
    expect(tree).toMatchObject({ exists: true, totalBytes: 3110, fileCount: 4 })
    expect(tree.entries).toEqual([
      { name: 'master.m3u8', kind: 'file', sizeBytes: 10, fileCount: 1 },
      {
        name: 'video',
        kind: 'dir',
        sizeBytes: 3100,
        fileCount: 3,
        children: [
          {
            name: '720p',
            kind: 'dir',
            sizeBytes: 3100,
            fileCount: 3,
            children: [
              { name: 'init.mp4', kind: 'file', sizeBytes: 100, fileCount: 1 },
              { name: 'seg_*.m4s', kind: 'segments', sizeBytes: 3000, fileCount: 2 }
            ]
          }
        ]
      }
    ])
  })

  it('reports folders that do not exist', async () => {
    expect(await readFolderTree(join(root, 'nope'))).toEqual({ exists: false, totalBytes: 0, fileCount: 0, entries: [] })
  })
})
