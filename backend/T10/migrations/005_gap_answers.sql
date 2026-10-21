CREATE TABLE IF NOT EXISTS t10.gap_answers (
  answer_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  gap_id uuid NOT NULL REFERENCES t10.gaps(gap_id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES t10.sources(source_id) ON DELETE RESTRICT,
  answer_text text NOT NULL,
  answer_status text NOT NULL DEFAULT 'provided' CHECK (answer_status IN ('provided','processed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gap_id, source_id, answer_text)
);

CREATE INDEX IF NOT EXISTS t10_gap_answers_profile_idx
  ON t10.gap_answers (profile_id, gap_id, created_at DESC);
