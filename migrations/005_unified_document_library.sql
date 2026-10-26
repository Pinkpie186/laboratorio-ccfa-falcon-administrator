ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'downloaded_internal';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS canonical_url text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS local_path text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS requires_authentication boolean NOT NULL DEFAULT true;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_permission text NOT NULL DEFAULT 'internal_authorized';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'available';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS etag text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_modified text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ccfa_relevant boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'current';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS origin_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_available boolean NOT NULL DEFAULT false;

ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS source_consulted_at timestamptz;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS source_etag text;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS source_last_modified text;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS supersedes_version_id uuid REFERENCES document_versions(id) ON DELETE SET NULL;

ALTER TABLE question_sources ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE question_sources ADD COLUMN IF NOT EXISTS source_title text;
ALTER TABLE question_sources ADD COLUMN IF NOT EXISTS source_version text;
ALTER TABLE question_sources ADD COLUMN IF NOT EXISTS relative_path text;
ALTER TABLE question_sources ADD COLUMN IF NOT EXISTS consulted_at timestamptz;
ALTER TABLE question_sources ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS document_reading_progress (
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents ON DELETE CASCADE,
  percent numeric(5,2) NOT NULL DEFAULT 0 CHECK(percent BETWEEN 0 AND 100),
  last_position text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,document_id)
);

CREATE TABLE IF NOT EXISTS document_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  local_document_id uuid NOT NULL REFERENCES documents ON DELETE CASCADE,
  public_document_id uuid NOT NULL REFERENCES documents ON DELETE CASCADE,
  match_type text NOT NULL,
  confidence numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(local_document_id,public_document_id)
);

CREATE TABLE IF NOT EXISTS document_history (
  id bigserial PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents ON DELETE CASCADE,
  version_id uuid REFERENCES document_versions ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_sync_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  source_scope text NOT NULL CHECK(source_scope IN ('local','public','all')),
  frequency text NOT NULL CHECK(frequency IN ('manual','daily','weekly')),
  enabled boolean NOT NULL DEFAULT false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id,source_scope,frequency)
);

CREATE TABLE IF NOT EXISTS import_failures (
  id bigserial PRIMARY KEY,
  import_run_id uuid REFERENCES import_runs ON DELETE CASCADE,
  safe_reference text NOT NULL,
  source_type text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_library_filters_idx ON documents(team_id,source_type,is_public,ccfa_relevant,review_status,last_checked_at DESC);
CREATE INDEX IF NOT EXISTS documents_canonical_url_idx ON documents(team_id,canonical_url) WHERE canonical_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_local_path_idx ON documents(team_id,local_path) WHERE local_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_history_document_idx ON document_history(document_id,created_at DESC);

ALTER TABLE document_reading_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_sync_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_scope_document_reading_progress ON document_reading_progress USING (team_id=nullif(current_setting('app.team_id',true),'')::uuid) WITH CHECK (team_id=nullif(current_setting('app.team_id',true),'')::uuid);
CREATE POLICY team_scope_document_matches ON document_matches USING (team_id=nullif(current_setting('app.team_id',true),'')::uuid) WITH CHECK (team_id=nullif(current_setting('app.team_id',true),'')::uuid);
CREATE POLICY team_scope_document_history ON document_history USING (team_id=nullif(current_setting('app.team_id',true),'')::uuid) WITH CHECK (team_id=nullif(current_setting('app.team_id',true),'')::uuid);
CREATE POLICY team_scope_library_sync_schedules ON library_sync_schedules USING (team_id=nullif(current_setting('app.team_id',true),'')::uuid) WITH CHECK (team_id=nullif(current_setting('app.team_id',true),'')::uuid);
