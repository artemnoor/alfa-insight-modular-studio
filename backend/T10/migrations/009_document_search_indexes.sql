CREATE INDEX IF NOT EXISTS t10_chunks_russian_fts_idx
  ON t10.document_chunks USING GIN (to_tsvector('russian', COALESCE(text_content, '')));

CREATE INDEX IF NOT EXISTS t10_chunks_english_fts_idx
  ON t10.document_chunks USING GIN (to_tsvector('english', COALESCE(text_content, '')));
