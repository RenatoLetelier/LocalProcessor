import type { PipelineResult } from '@pipeline/types'
import { toBcp47 } from '@pipeline/lang'
import { VIDEO_CODEC_NAME } from '@pipeline/metadata'
import { SUBTITLE_FORMAT } from '@pipeline/layout'
import type { Repositories } from '../db/repositories'
import { withTransaction } from '../db/transaction'

// Persists what a finished pipeline run produced. Idempotent: a retried job
// replaces whatever an earlier attempt may have recorded for the title.
export function recordResult(repos: Repositories, db: Parameters<typeof withTransaction>[0], result: PipelineResult): void {
  const { titleId, plan, source, metadata } = result

  withTransaction(db, () => {
    for (const r of repos.renditions.listByTitle(titleId)) repos.renditions.remove(r.id)
    for (const a of repos.audioTracks.listByTitle(titleId)) repos.audioTracks.remove(a.id)
    for (const s of repos.subtitleTracks.listByTitle(titleId)) repos.subtitleTracks.remove(s.id)

    for (const rendition of plan.renditions) {
      const measured = metadata.renditions.find((m) => m.label === rendition.label)
      repos.renditions.create({
        title_id: titleId,
        label: rendition.label,
        width: rendition.width,
        height: rendition.height,
        bitrate: measured?.bitrate ?? rendition.maxBitrateKbps * 1000,
        video_codec: VIDEO_CODEC_NAME,
        status: 'done'
      })
    }

    for (const audio of plan.audio) {
      const original = source.audio.find((t) => t.index === audio.sourceIndex)
      repos.audioTracks.create({
        title_id: titleId,
        source_index: audio.sourceIndex,
        language: audio.language,
        title: original?.title ?? null,
        codec_origen: original?.codec ?? audio.outputCodec,
        codec_salida: audio.outputCodec,
        channels: audio.channels,
        status: 'done'
      })
    }

    // Every source subtitle gets a row: included ones are done, image subtitles stay
    // pending (they would need OCR) and anything else that could not be converted is an error
    for (const subtitle of source.subtitles) {
      const included = plan.subtitles.some((s) => s.sourceIndex === subtitle.index)
      repos.subtitleTracks.create({
        title_id: titleId,
        source_index: subtitle.index,
        language: toBcp47(subtitle.language),
        title: subtitle.title,
        formato_origen: subtitle.codec,
        formato_salida: included ? SUBTITLE_FORMAT : null,
        requiere_ocr: subtitle.isImage,
        status: included ? 'done' : subtitle.isImage ? 'pending' : 'error'
      })
    }

    repos.titles.update(titleId, { status: 'done', error: null, output_folder: result.outputFolder })
  })
}
