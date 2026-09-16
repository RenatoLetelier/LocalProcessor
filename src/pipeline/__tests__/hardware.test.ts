import { describe, expect, it } from 'vitest'
import { ENCODERS, encoderGlobalArgs, probeArgs, videoCodecArgs, type EncoderKind } from '../encoders'
import { detectHardware, parseEncoderList } from '../hardware'
import type { Binaries, EncodePlan, RenditionPlan } from '../types'

const binaries: Binaries = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', packager: 'packager' }
const plan = { fps: { num: 24000, den: 1001 } } as EncodePlan
const rendition: RenditionPlan = { label: '720p', width: 1280, height: 534, maxBitrateKbps: 3000, gopFrames: 144 }

const windowAt = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

describe('videoCodecArgs', () => {
  it.each(ENCODERS.map((e) => e.kind))('%s keeps the shared contract: ceiling, fixed GOP, constant frame rate, High profile', (kind: EncoderKind) => {
    const args = videoCodecArgs(kind, rendition, plan, { preset: 'medium', crf: 20 })
    expect(windowAt(args, '-c:v')).toBe(kind)
    expect(windowAt(args, '-maxrate')).toBe('3000k')
    expect(windowAt(args, '-bufsize')).toBe('6000k')
    expect(windowAt(args, '-g')).toBe('144')
    expect(windowAt(args, '-keyint_min')).toBe('144')
    expect(windowAt(args, '-r')).toBe('24000/1001')
    expect(windowAt(args, '-fps_mode')).toBe('cfr')
    expect(windowAt(args, '-profile:v')).toBe('high')
    if (kind !== 'h264_vaapi') expect(windowAt(args, '-pix_fmt')).toBe('yuv420p')
  })

  it('maps the CRF to each encoder\'s constant-quality knob and disables scene cuts', () => {
    const x264 = videoCodecArgs('libx264', rendition, plan, { preset: 'slow', crf: 18 })
    expect(windowAt(x264, '-crf')).toBe('18')
    expect(windowAt(x264, '-preset')).toBe('slow')
    expect(windowAt(x264, '-sc_threshold')).toBe('0')

    const nvenc = videoCodecArgs('h264_nvenc', rendition, plan, { preset: 'medium', crf: 20 })
    expect(windowAt(nvenc, '-cq')).toBe('23')
    expect(windowAt(nvenc, '-rc')).toBe('vbr')
    expect(windowAt(nvenc, '-b:v')).toBe('0')
    expect(windowAt(nvenc, '-no-scenecut')).toBe('1')
    expect(windowAt(nvenc, '-forced-idr')).toBe('1')

    const qsv = videoCodecArgs('h264_qsv', rendition, plan, { preset: 'medium', crf: 20 })
    expect(windowAt(qsv, '-global_quality')).toBe('23')
    expect(windowAt(qsv, '-b:v')).toBe('3000k')
  })

  it('only VAAPI needs a device and GPU surfaces', () => {
    expect(encoderGlobalArgs('h264_vaapi')).toEqual(['-vaapi_device', '/dev/dri/renderD128'])
    expect(encoderGlobalArgs('h264_nvenc')).toEqual([])
    expect(probeArgs('h264_vaapi').join(' ')).toContain('format=nv12,hwupload')
    expect(probeArgs('h264_nvenc').join(' ')).toContain('-t 1')
    expect(probeArgs('libx264').join(' ')).toContain('-f null -')
  })
})

describe('parseEncoderList', () => {
  it('extracts video encoder names from ffmpeg -encoders output', () => {
    const text = [
      'Encoders:',
      ' V..... = Video',
      ' ------',
      ' V....D libx264              libx264 H.264 / AVC',
      ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)',
      ' V..... h264_qsv             H.264 (Intel Quick Sync Video acceleration) (codec h264)',
      ' A....D aac                  AAC (Advanced Audio Coding)'
    ].join('\n')
    expect([...parseEncoderList(text)]).toEqual(['libx264', 'h264_nvenc', 'h264_qsv'])
  })
})

describe('detectHardware', () => {
  const list = async (): Promise<string> => ' V....D libx264 x\n V....D h264_nvenc x\n V....D h264_qsv x\n V....D h264_amf x\n V....D h264_vaapi x\n'

  it('reports compiled-but-broken encoders as unavailable and prefers the best working one', async () => {
    const probed: string[] = []
    const info = await detectHardware(binaries, {
      platform: 'win32',
      listEncoders: list,
      probe: async (_b, kind) => {
        probed.push(kind)
        if (kind === 'h264_nvenc') throw new Error('ffmpeg terminó con código 1:\nCannot load nvcuda.dll')
        if (kind === 'h264_qsv') throw new Error('ffmpeg terminó con código 171:\nError initializing an MFX session')
      }
    })
    // VAAPI is not a Windows encoder, so it is never probed
    expect(probed).toEqual(['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'])
    expect(info.encoders.map((e) => [e.kind, e.available, e.error])).toEqual([
      ['h264_nvenc', false, 'Cannot load nvcuda.dll'],
      ['h264_qsv', false, 'Error initializing an MFX session'],
      ['h264_amf', true, undefined],
      ['libx264', true, undefined]
    ])
    expect(info.preferred).toBe('h264_amf')
    expect(info.platform).toBe('win32')
    expect(info.cpuThreads).toBeGreaterThan(0)
  })

  it('falls back to libx264 when nothing hardware works and marks missing encoders', async () => {
    const info = await detectHardware(binaries, {
      platform: 'linux',
      listEncoders: async () => ' V....D libx264 x\n',
      probe: async () => undefined
    })
    expect(info.encoders.map((e) => [e.kind, e.available, e.error])).toEqual([
      ['h264_nvenc', false, 'no incluido en este ffmpeg'],
      ['h264_qsv', false, 'no incluido en este ffmpeg'],
      ['h264_vaapi', false, 'no incluido en este ffmpeg'],
      ['libx264', true, undefined]
    ])
    expect(info.preferred).toBe('libx264')
  })
})
