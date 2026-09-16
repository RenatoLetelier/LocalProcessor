export const name = 'jobs-attempts-and-managed-sources'

export const sql = `
ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE titles ADD COLUMN source_managed INTEGER NOT NULL DEFAULT 0;
`
