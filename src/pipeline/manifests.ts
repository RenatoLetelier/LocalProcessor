import { rename, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import type { TitleMetadata } from './types'

// Shaka Packager can only write manifests for the streams it packages in one run,
// and re-packaging published segments is off the table (rule 4). Incremental jobs
// therefore package the new streams alone and merge the resulting manifests into
// the published ones here.

// ---------------------------------------------------------------- HLS master

const VIDEO_CODEC_PREFIXES = ['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'dvh1', 'dvhe']

interface HlsAttribute {
  key: string
  value: string
  quoted: boolean
}

interface HlsMedia {
  attributes: HlsAttribute[]
}

interface HlsVariant {
  attributes: HlsAttribute[]
  uri: string
}

interface HlsMaster {
  header: string[]
  media: HlsMedia[]
  variants: HlsVariant[]
}

export function parseMaster(text: string): HlsMaster {
  const master: HlsMaster = { header: [], media: [], variants: [] }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '') continue
    if (line.startsWith('#EXT-X-MEDIA:')) {
      master.media.push({ attributes: parseAttributes(line.slice('#EXT-X-MEDIA:'.length)) })
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      let uri = ''
      while (++i < lines.length) {
        const next = lines[i]!.trim()
        if (next !== '' && !next.startsWith('#')) {
          uri = next
          break
        }
      }
      master.variants.push({ attributes: parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length)), uri })
    } else {
      master.header.push(line)
    }
  }
  return master
}

export function parseAttributes(text: string): HlsAttribute[] {
  const attributes: HlsAttribute[] = []
  const pattern = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g
  for (const match of text.matchAll(pattern)) {
    const quoted = match[2]!.startsWith('"')
    attributes.push({ key: match[1]!, value: quoted ? match[3]! : match[2]!, quoted })
  }
  return attributes
}

const attr = (list: HlsAttribute[], key: string): string | undefined => list.find((a) => a.key === key)?.value

function setAttr(list: HlsAttribute[], key: string, value: string, quoted: boolean): void {
  const existing = list.find((a) => a.key === key)
  if (existing) {
    existing.value = value
  } else {
    list.push({ key, value, quoted })
  }
}

const codecsOf = (list: HlsAttribute[]): string[] => (attr(list, 'CODECS') ?? '').split(',').map((c) => c.trim()).filter(Boolean)
const isVideoCodec = (codec: string): boolean => VIDEO_CODEC_PREFIXES.some((p) => codec.startsWith(p))

export function serializeMaster(master: HlsMaster): string {
  const format = (list: HlsAttribute[]): string => list.map((a) => `${a.key}=${a.quoted ? `"${a.value}"` : a.value}`).join(',')
  const lines = [...master.header, '']
  for (const media of master.media) lines.push(`#EXT-X-MEDIA:${format(media.attributes)}`)
  if (master.media.length > 0) lines.push('')
  for (const variant of master.variants) lines.push(`#EXT-X-STREAM-INF:${format(variant.attributes)}`, variant.uri)
  return lines.join('\n') + '\n'
}

export function mergeMasterPlaylists(existingText: string, additionText: string): string {
  const existing = parseMaster(existingText)
  const addition = parseMaster(additionText)

  for (const line of addition.header) {
    if (!existing.header.includes(line) && !line.startsWith('##')) existing.header.push(line)
  }

  // A run without video yields an audio-only variant: only its codecs are useful
  const mediaUris = new Set([...existing.media, ...addition.media].map((m) => attr(m.attributes, 'URI')))
  const newAudioCodecs = new Set<string>()
  const videoVariants: HlsVariant[] = []
  for (const variant of addition.variants) {
    const codecs = codecsOf(variant.attributes)
    if (mediaUris.has(variant.uri) || !codecs.some(isVideoCodec)) {
      for (const codec of codecs) if (!isVideoCodec(codec)) newAudioCodecs.add(codec)
    } else {
      videoVariants.push(variant)
    }
  }

  const hasDefault = (type: string): boolean =>
    existing.media.some((m) => attr(m.attributes, 'TYPE') === type && attr(m.attributes, 'DEFAULT') === 'YES')
  for (const media of addition.media) {
    const uri = attr(media.attributes, 'URI')
    if (existing.media.some((m) => attr(m.attributes, 'URI') === uri)) continue
    if (hasDefault(attr(media.attributes, 'TYPE') ?? '')) setAttr(media.attributes, 'DEFAULT', 'NO', false)
    existing.media.push(media)
  }

  const existingAudioCodecs = new Set(existing.variants.flatMap((v) => codecsOf(v.attributes).filter((c) => !isVideoCodec(c))))
  const allAudioCodecs = [...new Set([...existingAudioCodecs, ...newAudioCodecs])]
  const groups = {
    AUDIO: existing.variants.map((v) => attr(v.attributes, 'AUDIO')).find(Boolean),
    SUBTITLES: existing.variants.map((v) => attr(v.attributes, 'SUBTITLES')).find(Boolean)
  }
  if (!groups.AUDIO && existing.media.some((m) => attr(m.attributes, 'TYPE') === 'AUDIO')) groups.AUDIO = 'audio'
  if (!groups.SUBTITLES && existing.media.some((m) => attr(m.attributes, 'TYPE') === 'SUBTITLES')) groups.SUBTITLES = 'subs'

  for (const variant of videoVariants) {
    if (existing.variants.some((v) => v.uri === variant.uri)) continue
    existing.variants.push(variant)
  }
  for (const variant of existing.variants) {
    const video = codecsOf(variant.attributes).filter(isVideoCodec)
    setAttr(variant.attributes, 'CODECS', [...video, ...allAudioCodecs].join(','), true)
    if (groups.AUDIO) setAttr(variant.attributes, 'AUDIO', groups.AUDIO, true)
    if (groups.SUBTITLES) setAttr(variant.attributes, 'SUBTITLES', groups.SUBTITLES, true)
  }

  return serializeMaster(existing)
}

// ---------------------------------------------------------------- DASH MPD

type XmlNode = Record<string, unknown> & { ':@'?: Record<string, string> }

const xmlOptions = { preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: false }

function children(node: XmlNode, tag: string): XmlNode[] {
  return (node[tag] as XmlNode[] | undefined) ?? []
}

function findChild(list: XmlNode[], tag: string): XmlNode | undefined {
  return list.find((n) => tag in n)
}

function maxId(nodes: XmlNode[], tag: string): number {
  let max = -1
  const visit = (list: XmlNode[]): void => {
    for (const node of list) {
      if (tag in node) max = Math.max(max, Number(node[':@']?.['@_id'] ?? -1))
      for (const key of Object.keys(node)) if (key !== ':@' && Array.isArray(node[key])) visit(node[key] as XmlNode[])
    }
  }
  visit(nodes)
  return max
}

export function mergeMpds(existingText: string, additionText: string): string {
  const parser = new XMLParser(xmlOptions)
  const existing = parser.parse(existingText) as XmlNode[]
  const addition = parser.parse(additionText) as XmlNode[]

  const mpd = findChild(existing, 'MPD')
  const period = mpd && findChild(children(mpd, 'MPD'), 'Period')
  const additionMpd = findChild(addition, 'MPD')
  const additionPeriod = additionMpd && findChild(children(additionMpd, 'MPD'), 'Period')
  if (!period || !additionPeriod) throw new Error('MPD sin Period: no se puede fusionar')

  const periodChildren = children(period, 'Period')
  let nextRepresentationId = maxId(existing, 'Representation') + 1
  let nextSetId = maxId(existing, 'AdaptationSet') + 1

  for (const set of children(additionPeriod, 'Period')) {
    if (!('AdaptationSet' in set)) continue
    const attributes = set[':@'] ?? {}
    const representations = children(set, 'AdaptationSet').filter((n) => 'Representation' in n)
    for (const rep of representations) {
      rep[':@'] = { ...rep[':@'], '@_id': String(nextRepresentationId++) }
    }

    const target =
      attributes['@_contentType'] === 'video'
        ? periodChildren.find((n) => 'AdaptationSet' in n && n[':@']?.['@_contentType'] === 'video')
        : undefined

    if (target) {
      // New video quality: same adaptation set, wider limits
      const targetAttributes = target[':@'] ?? {}
      const targetChildren = children(target, 'AdaptationSet')
      targetChildren.push(...representations)
      for (const key of ['@_maxWidth', '@_maxHeight'] as const) {
        const value = Math.max(Number(targetAttributes[key] ?? 0), Number(attributes[key] ?? 0))
        if (value > 0) targetAttributes[key] = String(value)
      }
      target[':@'] = targetAttributes
    } else {
      set[':@'] = { ...attributes, '@_id': String(nextSetId++) }
      periodChildren.push(set)
    }
  }

  return new XMLBuilder({ ...xmlOptions, format: true, indentBy: '  ', suppressEmptyNode: true }).build(existing) as string
}

// ---------------------------------------------------------------- metadata.json

export function mergeMetadata(existing: TitleMetadata, addition: TitleMetadata): TitleMetadata {
  const byKey = <T>(list: T[], extra: T[], key: (item: T) => string): T[] => {
    const seen = new Set(list.map(key))
    return [...list, ...extra.filter((item) => !seen.has(key(item)))]
  }
  return {
    ...existing,
    renditions: byKey(existing.renditions, addition.renditions, (r) => r.label),
    audioTracks: byKey(existing.audioTracks, addition.audioTracks, (a) => a.id),
    subtitleTracks: byKey(existing.subtitleTracks, addition.subtitleTracks, (s) => s.id),
    updatedAt: new Date().toISOString()
  }
}

// ---------------------------------------------------------------- atomic replace

// Readers see the old file or the new one, never a partial write. On Windows the
// rename fails while another process holds the file open, hence the retries.
export async function replaceFileAtomic(target: string, content: string, attempts = 8): Promise<void> {
  const tmp = `${target}.tmp`
  await writeFile(tmp, content, 'utf8')
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(tmp, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= attempts || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw error
      await sleep(50 * attempt)
    }
  }
}
