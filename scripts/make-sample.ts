// npm run make-sample -- [--out samples/sample.mkv] [--duration 20] [--size 1920x800] [--fps 24000/1001] [--hdr]
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveBinaries } from '../src/pipeline/binaries'
import { generateSample } from '../src/pipeline/testing/sample'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'samples/sample.mkv' },
    duration: { type: 'string', default: '20' },
    size: { type: 'string', default: '1920x800' },
    fps: { type: 'string', default: '24000/1001' },
    hdr: { type: 'boolean', default: false }
  }
})

const { ffmpeg } = resolveBinaries({ resourcesDir: resolve(__dirname, '..', 'resources') })
const out = generateSample(ffmpeg, {
  out: resolve(values.out),
  durationSeconds: Number(values.duration),
  size: values.size,
  fps: values.fps,
  hdr: values.hdr
})
console.log(`Muestra generada: ${out}`)
