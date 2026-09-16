// Synthetic test movie: colour bars; AAC stereo (spa), DTS 5.1 (eng, transcode
// path) and AC-3 stereo (fra, copy path); SRT (spa) and forced ASS (eng)
// subtitles. ffmpeg cannot synthesise image subtitles, so PGS/VobSub handling is
// covered by unit tests only. Dev/test only.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface SampleOptions {
  out: string
  durationSeconds?: number
  size?: string
  fps?: string
}

export function generateSample(ffmpeg: string, opts: SampleOptions): string {
  const { out, durationSeconds = 20, size = '1920x800', fps = '24000/1001' } = opts
  mkdirSync(dirname(out), { recursive: true })

  const srt = join(tmpdir(), `lp-sample-${process.pid}-${Date.now()}.srt`)
  writeFileSync(
    srt,
    ['1', '00:00:01,000 --> 00:00:04,000', 'Primer subtítulo', '', '2', '00:00:05,000 --> 00:00:08,000', 'Segundo subtítulo', ''].join('\n')
  )

  try {
    execFileSync(
      ffmpeg,
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${fps}`,
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
        '-f', 'srt', '-i', srt,
        '-t', String(durationSeconds),
        '-map', '0:v', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-map', '1:a', '-c:a:0', 'aac', '-ac:a:0', '2', '-b:a:0', '128k', '-metadata:s:a:0', 'language=spa', '-metadata:s:a:0', 'title=Español',
        '-map', '2:a', '-c:a:1', 'dca', '-strict', '-2', '-ac:a:1', '6', '-b:a:1', '768k', '-metadata:s:a:1', 'language=eng',
        '-map', '2:a', '-c:a:2', 'ac3', '-ac:a:2', '2', '-b:a:2', '192k', '-metadata:s:a:2', 'language=fra',
        '-map', '3:s', '-c:s:0', 'srt', '-metadata:s:s:0', 'language=spa',
        '-map', '3:s', '-c:s:1', 'ass', '-metadata:s:s:1', 'language=eng', '-metadata:s:s:1', 'title=Forced', '-disposition:s:1', 'forced',
        out
      ],
      { stdio: 'inherit', windowsHide: true }
    )
  } finally {
    rmSync(srt, { force: true })
  }
  return out
}
