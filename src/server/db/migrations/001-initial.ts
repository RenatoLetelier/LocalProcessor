export const name = 'initial'

export const sql = `
CREATE TABLE titles (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  source_path          TEXT NOT NULL,
  source_hash          TEXT,
  source_width         INTEGER,
  source_height        INTEGER,
  source_video_bitrate INTEGER,
  source_fps           REAL,
  source_video_codec   TEXT,
  duration_seconds     REAL,
  output_folder        TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'error')),
  error                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE renditions (
  id          TEXT PRIMARY KEY,
  title_id    TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  bitrate     INTEGER NOT NULL,
  video_codec TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'error')),
  UNIQUE (title_id, label)
);

CREATE TABLE audio_tracks (
  id           TEXT PRIMARY KEY,
  title_id     TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  source_index INTEGER NOT NULL,
  language     TEXT,
  title        TEXT,
  codec_origen TEXT NOT NULL,
  codec_salida TEXT,
  channels     INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'error')),
  UNIQUE (title_id, source_index)
);

CREATE TABLE subtitle_tracks (
  id             TEXT PRIMARY KEY,
  title_id       TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  source_index   INTEGER NOT NULL,
  language       TEXT,
  title          TEXT,
  formato_origen TEXT NOT NULL,
  formato_salida TEXT,
  requiere_ocr   INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'error')),
  UNIQUE (title_id, source_index)
);

CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  title_id     TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('inicial', 'agregar_calidad', 'agregar_pista', 'reprocesar_completo')),
  status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error', 'cancelled')),
  config_json  TEXT NOT NULL,
  progress     REAL NOT NULL DEFAULT 0,
  current_step TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT
);

CREATE INDEX jobs_status_created_at ON jobs (status, created_at);
CREATE INDEX jobs_title_id ON jobs (title_id);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`
