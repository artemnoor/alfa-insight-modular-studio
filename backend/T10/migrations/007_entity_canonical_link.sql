ALTER TABLE t10.entities
  ADD COLUMN IF NOT EXISTS canonical_entity_id uuid REFERENCES t10.entities(entity_id) ON DELETE SET NULL;

ALTER TABLE t10.entities
  DROP CONSTRAINT IF EXISTS t10_entities_not_self_canonical;

ALTER TABLE t10.entities
  ADD CONSTRAINT t10_entities_not_self_canonical
  CHECK (canonical_entity_id IS NULL OR canonical_entity_id <> entity_id);

CREATE INDEX IF NOT EXISTS t10_entities_canonical_link_idx
  ON t10.entities (profile_id, canonical_entity_id)
  WHERE canonical_entity_id IS NOT NULL;
