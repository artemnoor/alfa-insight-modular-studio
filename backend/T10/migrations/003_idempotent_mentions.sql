CREATE UNIQUE INDEX IF NOT EXISTS t10_mentions_source_evidence_unique
  ON t10.entity_mentions (profile_id, entity_id, source_id, evidence_quote, start_offset);
