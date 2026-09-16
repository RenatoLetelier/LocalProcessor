import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

const SAMPLE_BYTES = 64 * 1024 * 1024

// Partial fingerprint (size + first and last 64 MB): enough to notice a replaced
// source without reading a 30 GB file end to end.
export async function sourceHash(path: string): Promise<string> {
  const { size } = await stat(path)
  const hash = createHash('sha256')
  hash.update(`size:${size}\n`)

  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(Math.min(SAMPLE_BYTES, size))
    await handle.read(head, 0, head.length, 0)
    hash.update(head)

    if (size > SAMPLE_BYTES) {
      const tailStart = Math.max(SAMPLE_BYTES, size - SAMPLE_BYTES)
      const tail = Buffer.alloc(size - tailStart)
      await handle.read(tail, 0, tail.length, tailStart)
      hash.update(tail)
    }
  } finally {
    await handle.close()
  }

  return hash.digest('hex')
}
