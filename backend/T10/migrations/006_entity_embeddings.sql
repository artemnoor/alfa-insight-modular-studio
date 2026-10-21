CREATE TABLE IF NOT EXISTS t10.entity_embeddings (
  entity_id uuid PRIMARY KEY REFERENCES t10.entities(entity_id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  embedding vector(4096) NOT NULL,
  embedding_model text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS t10_entity_embeddings_profile_idx
  ON t10.entity_embeddings (profile_id, entity_id);
