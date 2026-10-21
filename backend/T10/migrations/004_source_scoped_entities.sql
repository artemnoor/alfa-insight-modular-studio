ALTER TABLE t10.entities
  ADD COLUMN IF NOT EXISTS origin_source_id uuid REFERENCES t10.sources(source_id) ON DELETE CASCADE;

ALTER TABLE t10.entities
  DROP CONSTRAINT IF EXISTS entities_profile_id_entity_type_normalized_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS t10_entities_source_scoped_unique
  ON t10.entities (profile_id, entity_type, normalized_name, origin_source_id)
  WHERE origin_source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS t10_entities_profile_scoped_unique
  ON t10.entities (profile_id, entity_type, normalized_name)
  WHERE origin_source_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS t10_entity_resolution_decisions_idempotent
  ON t10.entity_resolution_decisions (profile_id, source_entity_id, decision, decided_by, reason);
