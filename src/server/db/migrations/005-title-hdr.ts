export const name = 'title-source-hdr'

// 'pq' | 'hlg' when the source is HDR (the output is tone-mapped to SDR); NULL for SDR sources
export const sql = `
ALTER TABLE titles ADD COLUMN source_hdr TEXT;
`
