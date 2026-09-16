import type { AudioPlan, SubtitlePlan } from './types'

// Layout of a published title folder (all paths relative to <output>/<titleId>/):
//   master.m3u8, manifest.mpd, metadata.json
//   video/<label>/init.mp4 + seg_00001.m4s… + playlist.m3u8
//   audio/<sourceIndex>_<language>_<codec>/init.mp4 + seg_… + playlist.m3u8
//   subs/<sourceIndex>_<language>/seg_00001.vtt… + playlist.m3u8 (same segments serve HLS and DASH)
export const MASTER_PLAYLIST = 'master.m3u8'
export const DASH_MANIFEST = 'manifest.mpd'
export const METADATA_FILE = 'metadata.json'
export const INIT_SEGMENT = 'init.mp4'
export const SEGMENT_TEMPLATE = 'seg_$Number%05d$.m4s'
export const SUBTITLE_SEGMENT_TEMPLATE = 'seg_$Number%05d$.vtt'
export const SUBTITLE_FORMAT = 'vtt'
export const MEDIA_PLAYLIST = 'playlist.m3u8'

// Work-in-progress folders live next to the titles so the final rename stays on one volume
export const WORK_DIR = '.tmp'

export const renditionDir = (label: string): string => `video/${label}`
export const audioTrackId = (audio: AudioPlan): string => `${audio.sourceIndex}_${audio.language}_${audio.outputCodec}`
export const audioDir = (audio: AudioPlan): string => `audio/${audioTrackId(audio)}`

export const subtitleTrackId = (subtitle: SubtitlePlan): string => `${subtitle.sourceIndex}_${subtitle.language}`
export const subtitleDir = (subtitle: SubtitlePlan): string => `subs/${subtitleTrackId(subtitle)}`

export const encodedVideoFile = (label: string): string => `video_${label}.mp4`
export const encodedAudioFile = (sourceIndex: number): string => `audio_${sourceIndex}.mp4`
export const encodedSubtitleFile = (sourceIndex: number): string => `sub_${sourceIndex}.vtt`
