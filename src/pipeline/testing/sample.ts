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
  // HEVC 10-bit PQ/BT.2020 with HDR10 static metadata (1000-nit display, MaxCLL 800) instead of 8-bit H.264
  hdr?: boolean
}

// The colour bars are generated in SDR and merely signalled as PQ: enough to drive
// the detection and the tone-mapping path, not a real HDR grade. The signalling
// goes through x265 itself; ffmpeg 8 treats the -color_* output options as a
// request to convert the picture instead.
const HDR10_X265_PARAMS = [
  'hdr10=1',
  'colorprim=bt2020',
  'transfer=smpte2084',
  'colormatrix=bt2020nc',
  'master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)',
  'max-cll=800,300'
].join(':')

export function generateSample(ffmpeg: string, opts: SampleOptions): string {
  const { out, durationSeconds = 20, size = '1920x800', fps = '24000/1001', hdr = false } = opts
  mkdirSync(dirname(out), { recursive: true })
  const video = hdr
    ? ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p10le', '-x265-params', HDR10_X265_PARAMS]
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']

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
        '-map', '0:v', ...video,
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
