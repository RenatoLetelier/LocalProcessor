// Runs the pipeline on one file without Electron or the database:
//   npm run process -- <input> --out <folder> [--quality 1080p,720p,480p] [--segment 6] [--standards hls,dash] [--preset medium] [--verbose]
import { randomUUID } from 'node:crypto'
import { basename, extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_CONFIG, type Standard } from '../src/shared/config'
import { processTitle, resolveBinaries } from '../src/pipeline'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    quality: { type: 'string', default: DEFAULT_CONFIG.qualities.join(',') },
    segment: { type: 'string', default: String(DEFAULT_CONFIG.segmentDurationSeconds) },
    standards: { type: 'string', default: 'hls' },
    preset: { type: 'string', default: 'medium' },
    id: { type: 'string' },
    name: { type: 'string' },
    verbose: { type: 'boolean', default: false }
  }
})

const input = positionals[0]
if (!input || !values.out) {
  console.error('Uso: npm run process -- <archivo> --out <carpeta> [--quality 1080p,720p] [--segment 6] [--standards hls,dash]')
  process.exit(2)
}

const sourcePath = resolve(input)
const titleId = values.id ?? randomUUID()
const binaries = resolveBinaries({ resourcesDir: resolve(__dirname, '..', 'resources') })

let lastLine = ''
const started = Date.now()

processTitle(
  binaries,
  {
    titleId,
    name: values.name ?? basename(sourcePath, extname(sourcePath)),
    sourcePath,
    outputRoot: resolve(values.out),
    standards: values.standards.split(',').map((s) => s.trim() as Standard),
    plan: {
      rungs: DEFAULT_CONFIG.rungs,
      qualities: values.quality.split(',').map((q) => q.trim()).filter(Boolean),
      segmentDurationSeconds: Number(values.segment)
    },
    videoEncoder: { preset: values.preset }
  },
  {
    onProgress: (event) => {
      const line = `[${event.step}] ${event.percent.toFixed(1)}%`
      if (line !== lastLine) {
        process.stderr.write(`\r${line.padEnd(40)}`)
        lastLine = line
      }
    },
    onLog: (line) => {
      if (values.verbose) process.stderr.write(`\n${line}`)
    }
  }
)
  .then((result) => {
    process.stderr.write('\n')
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`Listo en ${seconds}s → ${result.outputFolder}`)
    console.log(
      JSON.stringify(
        {
          source: {
            video: `${result.source.video.codec} ${result.source.video.displayWidth}x${result.source.video.displayHeight}`,
            fps: `${result.plan.fps.num}/${result.plan.fps.den}`,
            audio: result.source.audio.map((a) => `${a.index}:${a.codec}/${a.channels}ch/${a.language ?? 'und'}`),
            subtitles: result.source.subtitles.map((s) => `${s.index}:${s.codec}/${s.language ?? 'und'}`)
          },
          renditions: result.metadata.renditions,
          audioTracks: result.metadata.audioTracks,
          skipped: result.plan.skipped
        },
        null,
        2
      )
    )
  })
  .catch((error: unknown) => {
    process.stderr.write('\n')
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
