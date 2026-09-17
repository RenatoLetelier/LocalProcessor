export const name = 'nullable-source-path'

// Titles imported from an output folder may not know their source file until
// the user links one. NOT NULL cannot be dropped in place, and rebuilding the
// table would fire the children's ON DELETE CASCADE, so the column is swapped.
export const sql = `
ALTER TABLE titles RENAME COLUMN source_path TO source_path_old;
ALTER TABLE titles ADD COLUMN source_path TEXT;
UPDATE titles SET source_path = source_path_old;
ALTER TABLE titles DROP COLUMN source_path_old;
`
