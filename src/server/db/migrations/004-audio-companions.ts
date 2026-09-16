export const name = 'audio-companion-tracks'

// A copied AC-3/E-AC-3 track now also publishes an AAC version: the same source
// index appears once per output codec. SQLite cannot alter a UNIQUE constraint in
// place, so the table is rebuilt (nothing references audio_tracks).
export const sql = `
CREATE TABLE audio_tracks_v2 (
  id           TEXT PRIMARY KEY,
  title_id     TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  source_index INTEGER NOT NULL,
  language     TEXT,
  title        TEXT,
  codec_origen TEXT NOT NULL,
  codec_salida TEXT,
  channels     INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'error')),
  source_path  TEXT,
  UNIQUE (title_id, source_index, codec_salida)
);
INSERT INTO audio_tracks_v2 (id, title_id, source_index, language, title, codec_origen, codec_salida, channels, status, source_path)
  SELECT id, title_id, source_index, language, title, codec_origen, codec_salida, channels, status, source_path FROM audio_tracks;
DROP TABLE audio_tracks;
ALTER TABLE audio_tracks_v2 RENAME TO audio_tracks;
`
