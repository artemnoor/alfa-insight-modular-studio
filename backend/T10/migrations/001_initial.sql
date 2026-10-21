CREATE SCHEMA IF NOT EXISTS t10;

CREATE TABLE IF NOT EXISTS t10.companies (
  company_id uuid PRIMARY KEY,
  legal_name text NOT NULL,
  normalized_name text NOT NULL,
  inn text,
  ogrn text,
  website text,
  identity_status text NOT NULL CHECK (identity_status IN ('name_only', 'identifier_provided', 'verified', 'ambiguous', 'unresolved')),
  identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (inn IS NULL OR inn ~ '^[0-9]{10}([0-9]{2})?$'),
  CHECK (ogrn IS NULL OR ogrn ~ '^[0-9]{13}([0-9]{2})?$')
);

CREATE UNIQUE INDEX IF NOT EXISTS t10_companies_inn_unique ON t10.companies (inn) WHERE inn IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS t10_companies_ogrn_unique ON t10.companies (ogrn) WHERE ogrn IS NOT NULL;
CREATE INDEX IF NOT EXISTS t10_companies_name_idx ON t10.companies (normalized_name);

CREATE TABLE IF NOT EXISTS t10.profiles (
  profile_id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES t10.companies(company_id) ON DELETE RESTRICT,
  profile_name text NOT NULL,
  client_ref text,
  profile_status text NOT NULL DEFAULT 'active' CHECK (profile_status IN ('active', 'archived')),
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS t10_profiles_company_idx ON t10.profiles (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS t10.runs (
  run_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  run_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  trigger text NOT NULL CHECK (trigger IN ('manual', 'upload', 'enrichment', 'system')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (profile_id, run_number)
);
CREATE INDEX IF NOT EXISTS t10_runs_profile_idx ON t10.runs (profile_id, started_at DESC);

CREATE TABLE IF NOT EXISTS t10.block_runs (
  block_run_id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES t10.runs(run_id) ON DELETE CASCADE,
  block_id text NOT NULL CHECK (block_id IN ('B01','B02','B03','B04','B05','B06','B07','B08','B09','B10','B11')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'skipped')),
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb,
  error_text text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (run_id, block_id)
);

CREATE TABLE IF NOT EXISTS t10.sources (
  source_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('user_input', 'document', 'official_registry', 'company_website', 'annual_report', 'catalog', 'public_source', 'internal_system')),
  title text NOT NULL,
  url text,
  external_id text,
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  access_level text NOT NULL CHECK (access_level IN ('public', 'customer_internal', 'confidential')),
  content_type text,
  content_text text,
  content_bytes bytea,
  content_sha256 text NOT NULL,
  source_status text NOT NULL DEFAULT 'available' CHECK (source_status IN ('queued', 'available', 'processed', 'unavailable', 'rejected', 'failed')),
  error_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, content_sha256),
  CHECK (url IS NULL OR url ~ '^https?://')
);
CREATE INDEX IF NOT EXISTS t10_sources_profile_idx ON t10.sources (profile_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS t10_sources_external_idx ON t10.sources (profile_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS t10.document_chunks (
  chunk_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES t10.sources(source_id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  text_content text NOT NULL,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset >= start_offset),
  page_number integer,
  section_path text,
  token_count integer,
  content_sha256 text NOT NULL,
  embedding vector(4096),
  embedding_model text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS t10_chunks_profile_idx ON t10.document_chunks (profile_id, source_id, chunk_index);

CREATE TABLE IF NOT EXISTS t10.entities (
  entity_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('COMPANY','BUSINESS_UNIT','PRODUCT','SERVICE','COMPONENT','FACILITY','RESOURCE','PROCESS','CONTRACT','LOCATION','PERSON','TECHNOLOGY')),
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  global_company_id uuid REFERENCES t10.companies(company_id) ON DELETE SET NULL,
  identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_status text NOT NULL DEFAULT 'unresolved' CHECK (resolution_status IN ('resolved', 'candidate', 'unresolved', 'conflicted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, entity_type, normalized_name)
);
CREATE INDEX IF NOT EXISTS t10_entities_profile_idx ON t10.entities (profile_id, entity_type, canonical_name);
CREATE INDEX IF NOT EXISTS t10_entities_global_idx ON t10.entities (global_company_id) WHERE global_company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS t10.entity_mentions (
  mention_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES t10.entities(entity_id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES t10.sources(source_id) ON DELETE CASCADE,
  chunk_id uuid REFERENCES t10.document_chunks(chunk_id) ON DELETE SET NULL,
  surface text NOT NULL,
  evidence_quote text NOT NULL,
  start_offset integer,
  end_offset integer,
  extraction jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS t10_mentions_entity_idx ON t10.entity_mentions (profile_id, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS t10.entity_resolution_decisions (
  decision_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  source_entity_id uuid NOT NULL REFERENCES t10.entities(entity_id) ON DELETE CASCADE,
  candidate_entity_id uuid REFERENCES t10.entities(entity_id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('SAME_ENTITY','DIFFERENT_ENTITY','UNRESOLVED')),
  decided_by text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS t10.claims (
  claim_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  claim_hash text NOT NULL,
  subject_entity_id uuid NOT NULL REFERENCES t10.entities(entity_id) ON DELETE CASCADE,
  predicate text NOT NULL,
  object_entity_id uuid REFERENCES t10.entities(entity_id) ON DELETE SET NULL,
  object_value jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_status text NOT NULL CHECK (claim_status IN ('CONFIRMED','SUPPORTED','CANDIDATE','CONFLICTED','REJECTED','UNKNOWN')),
  valid_from timestamptz,
  valid_to timestamptz,
  created_in_run_id uuid REFERENCES t10.runs(run_id) ON DELETE SET NULL,
  supersedes_claim_id uuid REFERENCES t10.claims(claim_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, claim_hash),
  CHECK (object_entity_id IS NOT NULL OR object_value IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS t10_claims_profile_status_idx ON t10.claims (profile_id, claim_status, created_at DESC);
CREATE INDEX IF NOT EXISTS t10_claims_subject_idx ON t10.claims (profile_id, subject_entity_id, predicate);

CREATE TABLE IF NOT EXISTS t10.claim_evidence (
  evidence_id uuid PRIMARY KEY,
  claim_id uuid NOT NULL REFERENCES t10.claims(claim_id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES t10.sources(source_id) ON DELETE RESTRICT,
  chunk_id uuid REFERENCES t10.document_chunks(chunk_id) ON DELETE SET NULL,
  quote text NOT NULL,
  start_offset integer,
  end_offset integer,
  quote_matches_source boolean NOT NULL DEFAULT false,
  fact_validation text NOT NULL CHECK (fact_validation IN ('text_match_only','user_asserted','registry_verified','model_supported','reviewed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, source_id, quote)
);
CREATE INDEX IF NOT EXISTS t10_claim_evidence_profile_idx ON t10.claim_evidence (profile_id, claim_id);

CREATE TABLE IF NOT EXISTS t10.rejected_proposals (
  proposal_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  run_id uuid REFERENCES t10.runs(run_id) ON DELETE SET NULL,
  source_id uuid REFERENCES t10.sources(source_id) ON DELETE SET NULL,
  proposed_json jsonb NOT NULL,
  rejection_code text NOT NULL,
  rejection_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS t10.gaps (
  gap_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  related_entity_id uuid REFERENCES t10.entities(entity_id) ON DELETE SET NULL,
  gap_key text NOT NULL,
  missing_fact text NOT NULL,
  importance text NOT NULL,
  rationale text NOT NULL,
  priority integer NOT NULL CHECK (priority BETWEEN 1 AND 5),
  suggested_source text,
  question text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dismissed','blocked')),
  created_in_run_id uuid REFERENCES t10.runs(run_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, gap_key)
);
CREATE INDEX IF NOT EXISTS t10_gaps_queue_idx ON t10.gaps (profile_id, status, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS t10.enrichment_attempts (
  attempt_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  gap_id uuid REFERENCES t10.gaps(gap_id) ON DELETE SET NULL,
  run_id uuid REFERENCES t10.runs(run_id) ON DELETE SET NULL,
  source_type text NOT NULL,
  query_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed','partial','unavailable','failed','skipped')),
  result_source_id uuid REFERENCES t10.sources(source_id) ON DELETE SET NULL,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS t10.profile_versions (
  profile_version_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  run_id uuid REFERENCES t10.runs(run_id) ON DELETE SET NULL,
  profile_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);

CREATE TABLE IF NOT EXISTS t10.model_calls (
  model_call_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES t10.profiles(profile_id) ON DELETE CASCADE,
  run_id uuid REFERENCES t10.runs(run_id) ON DELETE SET NULL,
  block_run_id uuid REFERENCES t10.block_runs(block_run_id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed','partial','failed')),
  input_tokens integer,
  output_tokens integer,
  cost_rub numeric(14,6),
  latency_ms integer,
  response_json jsonb,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS t10_model_calls_run_idx ON t10.model_calls (profile_id, run_id, created_at);
