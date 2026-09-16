export const name = 'external-track-sources'

// NULL = the track comes from the title's own source file; otherwise the path of
// the external file it was added from (negative source_index = external track)
export const sql = `
ALTER TABLE audio_tracks ADD COLUMN source_path TEXT;
ALTER TABLE subtitle_tracks ADD COLUMN source_path TEXT;
`
