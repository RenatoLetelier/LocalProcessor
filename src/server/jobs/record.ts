import type { DatabaseSync } from 'node:sqlite'
import type { PipelineResult } from '@pipeline/types'
import { toBcp47 } from '@pipeline/lang'
import { VIDEO_CODEC_NAME } from '@pipeline/metadata'
import { SUBTITLE_FORMAT } from '@pipeline/layout'
import type { Repositories } from '../db/repositories'
import { withTransaction } from '../db/transaction'

// Persists what a full pipeline run produced. Idempotent: a retried job replaces
// whatever an earlier attempt may have recorded for the title.
export function recordResult(repos: Repositories, db: DatabaseSync, result: PipelineResult): void {
  const { titleId, plan, source, metadata } = result

  withTransaction(db, () => {
    for (const r of repos.renditions.listByTitle(titleId)) repos.renditions.remove(r.id)
    for (const a of repos.audioTracks.listByTitle(titleId)) repos.audioTracks.remove(a.id)
    for (const s of repos.subtitleTracks.listByTitle(titleId)) repos.subtitleTracks.remove(s.id)

    for (const rendition of plan.renditions) {
      repos.renditions.create({
        title_id: titleId,
        label: rendition.label,
        width: rendition.width,
        height: rendition.height,
        bitrate: measuredBitrate(result, rendition.label, rendition.maxBitrateKbps),
        video_codec: VIDEO_CODEC_NAME,
        status: 'done'
      })
    }

    for (const audio of plan.audio) {
      repos.audioTracks.create({
        title_id: titleId,
        source_index: audio.sourceIndex,
        source_path: audio.input.path ?? null,
        language: audio.language,
        title: audio.title,
        codec_origen: audio.sourceCodec,
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
    for (const subtitle of plan.subtitles.filter((s) => s.input.path)) {
      repos.subtitleTracks.create({
        title_id: titleId,
        source_index: subtitle.sourceIndex,
        source_path: subtitle.input.path,
        language: subtitle.language,
        title: subtitle.title,
        formato_origen: subtitle.sourceCodec,
        formato_salida: SUBTITLE_FORMAT,
        status: 'done'
      })
    }
    // External tracks that could not be read stay visible as errors
    for (const item of plan.skipped) {
      const index = Number(item.id)
      if (!(index < 0)) continue
      const row =
        item.kind === 'audio'
          ? repos.audioTracks.listByTitle(titleId).find((a) => a.source_index === index)
          : repos.subtitleTracks.listByTitle(titleId).find((s) => s.source_index === index)
      if (!row) continue
      if (item.kind === 'audio') repos.audioTracks.update(row.id, { status: 'error' })
      else repos.subtitleTracks.update(row.id, { status: 'error' })
    }

    repos.titles.update(titleId, { status: 'done', error: null, output_folder: result.outputFolder })
  })
}

// Persists what an incremental job added: new rendition rows, and track rows
// created or flipped to done (external tracks were inserted as pending at enqueue)
export function recordIncremental(repos: Repositories, db: DatabaseSync, result: PipelineResult): void {
  const { titleId, plan } = result

  withTransaction(db, () => {
    for (const rendition of plan.renditions) {
      repos.renditions.create({
        title_id: titleId,
        label: rendition.label,
        width: rendition.width,
        height: rendition.height,
        bitrate: measuredBitrate(result, rendition.label, rendition.maxBitrateKbps),
        video_codec: VIDEO_CODEC_NAME,
        status: 'done'
      })
    }

    const audioRows = repos.audioTracks.listByTitle(titleId)
    const claimed = new Set<string>()
    for (const audio of plan.audio) {
      // The row of this output codec, or the pending one inserted at enqueue (no codec yet);
      // a Dolby track claims it for the copy and gets a second row for the AAC companion
      const row = audioRows.find(
        (a) => a.source_index === audio.sourceIndex && !claimed.has(a.id) && (a.codec_salida === audio.outputCodec || a.codec_salida === null)
      )
      if (row) {
        claimed.add(row.id)
        repos.audioTracks.update(row.id, { codec_salida: audio.outputCodec, channels: audio.channels, status: 'done' })
      } else {
        repos.audioTracks.create({
          title_id: titleId,
          source_index: audio.sourceIndex,
          source_path: audio.input.path ?? null,
          language: audio.language,
          title: audio.title,
          codec_origen: audio.sourceCodec,
          codec_salida: audio.outputCodec,
          channels: audio.channels,
          status: 'done'
        })
      }
    }

    const subtitleRows = repos.subtitleTracks.listByTitle(titleId)
    for (const subtitle of plan.subtitles) {
      const row = subtitleRows.find((s) => s.source_index === subtitle.sourceIndex)
      if (row) repos.subtitleTracks.update(row.id, { formato_salida: SUBTITLE_FORMAT, status: 'done' })
      else {
        repos.subtitleTracks.create({
          title_id: titleId,
          source_index: subtitle.sourceIndex,
          source_path: subtitle.input.path ?? null,
          language: subtitle.language,
          title: subtitle.title,
          formato_origen: subtitle.sourceCodec,
          formato_salida: SUBTITLE_FORMAT,
          status: 'done'
        })
      }
    }

    for (const item of plan.skipped) {
      const index = Number(item.id)
      if (item.kind === 'audio') {
        const row = audioRows.find((a) => a.source_index === index)
        if (row) repos.audioTracks.update(row.id, { status: 'error' })
      } else if (item.kind === 'subtitle') {
        const row = subtitleRows.find((s) => s.source_index === index)
        if (row && !row.requiere_ocr) repos.subtitleTracks.update(row.id, { status: 'error' })
      }
    }

    repos.titles.update(titleId, { status: 'done', error: null })
  })
}

function measuredBitrate(result: PipelineResult, label: string, maxBitrateKbps: number): number {
  return result.metadata.renditions.find((m) => m.label === label)?.bitrate ?? maxBitrateKbps * 1000
}
