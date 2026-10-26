CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  slug text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE roles (id smallserial PRIMARY KEY, code text UNIQUE NOT NULL, label text NOT NULL);
INSERT INTO roles(code,label) VALUES ('analyst','Analista'),('manager','Gestor'),('admin_reviewer','Administrador/Revisor') ON CONFLICT DO NOTHING;
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
  display_name text NOT NULL, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
  mfa_ready boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  team_id uuid REFERENCES teams ON DELETE CASCADE, user_id uuid REFERENCES users ON DELETE CASCADE,
  role_id smallint REFERENCES roles, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(team_id,user_id)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL, csrf_token text NOT NULL, expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(), ip_hash text, user_agent text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, title text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 0, position integer NOT NULL, official_url text,
  official_module_count integer, source_note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE submodules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), course_id uuid REFERENCES courses ON DELETE CASCADE,
  title text NOT NULL, position integer NOT NULL, duration_minutes integer,
  source_type text NOT NULL CHECK(source_type IN ('authorized_import','manual')),
  source_document_id uuid, created_by uuid REFERENCES users, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(course_id,title)
);
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  external_id text, title text NOT NULL, category text NOT NULL, product text, language text NOT NULL DEFAULT 'pt-BR',
  source_url text, source_kind text NOT NULL DEFAULT 'upload', access_mode text NOT NULL DEFAULT 'restricted',
  publication_date date, updated_date date, synchronized_at timestamptz, current_version_id uuid,
  favorite_count integer NOT NULL DEFAULT 0, stale boolean NOT NULL DEFAULT false, created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(team_id,source_url)
);
CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid REFERENCES documents ON DELETE CASCADE,
  version_label text, sha256 text NOT NULL, mime_type text, byte_size bigint, storage_key text,
  extraction_status text NOT NULL DEFAULT 'pending', extraction_error text, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(document_id,sha256)
);
ALTER TABLE documents ADD CONSTRAINT documents_current_version_fk FOREIGN KEY(current_version_id) REFERENCES document_versions(id);
ALTER TABLE submodules ADD CONSTRAINT submodules_source_document_fk FOREIGN KEY(source_document_id) REFERENCES documents(id);
CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid REFERENCES document_versions ON DELETE CASCADE,
  ordinal integer NOT NULL, page_number integer, section text, content text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('portuguese',coalesce(section,'') || ' ' || content)) STORED,
  UNIQUE(version_id,ordinal)
);
CREATE INDEX document_chunks_search_idx ON document_chunks USING gin(search_vector);
CREATE TABLE document_favorites (user_id uuid REFERENCES users ON DELETE CASCADE, document_id uuid REFERENCES documents ON DELETE CASCADE, created_at timestamptz DEFAULT now(), PRIMARY KEY(user_id,document_id));
CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  author_id uuid REFERENCES users, category text NOT NULL, subcategory text, difficulty text NOT NULL,
  format text NOT NULL, objective text, prompt text NOT NULL, options jsonb NOT NULL DEFAULT '[]',
  correct_answer jsonb NOT NULL, explanation text NOT NULL, status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1, generated_by_ai boolean NOT NULL DEFAULT false,
  revalidate boolean NOT NULL DEFAULT false, approved_by uuid REFERENCES users, approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status IN ('draft','review','approved','published','archived','rejected'))
);
CREATE TABLE question_sources (
  question_id uuid REFERENCES questions ON DELETE CASCADE, version_id uuid REFERENCES document_versions ON DELETE RESTRICT,
  source_url text NOT NULL, section text, page_number integer, excerpt text NOT NULL,
  PRIMARY KEY(question_id,version_id,source_url)
);
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  question_id uuid REFERENCES questions ON DELETE CASCADE, reviewer_id uuid REFERENCES users,
  decision text NOT NULL, comment text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE question_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question_id uuid REFERENCES questions ON DELETE CASCADE,
  user_id uuid REFERENCES users, reason text NOT NULL, status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now()
);
CREATE TABLE simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users, mode text NOT NULL, seed text NOT NULL, question_count integer NOT NULL,
  duration_minutes integer NOT NULL, category_filter jsonb DEFAULT '[]', difficulty_filter jsonb DEFAULT '[]',
  started_at timestamptz DEFAULT now(), finished_at timestamptz, score numeric(5,2), status text DEFAULT 'active'
);
CREATE TABLE simulation_questions (
  simulation_id uuid REFERENCES simulations ON DELETE CASCADE, question_id uuid REFERENCES questions,
  question_version integer NOT NULL, position integer NOT NULL, PRIMARY KEY(simulation_id,position), UNIQUE(simulation_id,question_id)
);
CREATE TABLE attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users, simulation_id uuid REFERENCES simulations ON DELETE SET NULL,
  question_id uuid REFERENCES questions, question_version integer NOT NULL, correct boolean NOT NULL,
  elapsed_seconds integer NOT NULL DEFAULT 0, confidence smallint, created_at timestamptz DEFAULT now()
);
CREATE TABLE answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), simulation_id uuid REFERENCES simulations ON DELETE CASCADE,
  question_id uuid REFERENCES questions, user_id uuid REFERENCES users, answer jsonb NOT NULL,
  correct boolean NOT NULL, elapsed_seconds integer DEFAULT 0, answered_at timestamptz DEFAULT now(), UNIQUE(simulation_id,question_id)
);
CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users, target_date date NOT NULL, status text DEFAULT 'active', created_at timestamptz DEFAULT now()
);
CREATE TABLE availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK(weekday BETWEEN 0 AND 6), start_time time NOT NULL, end_time time NOT NULL,
  session_minutes integer NOT NULL DEFAULT 45, timezone text NOT NULL DEFAULT 'America/Sao_Paulo'
);
CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users ON DELETE CASCADE,
  goal_id uuid REFERENCES goals ON DELETE CASCADE, revision integer NOT NULL DEFAULT 1,
  reason text, created_at timestamptz DEFAULT now(), superseded_at timestamptz
);
CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id uuid REFERENCES schedules ON DELETE CASCADE,
  user_id uuid REFERENCES users, activity_type text NOT NULL, reference_id uuid, title text NOT NULL,
  planned_start timestamptz NOT NULL, planned_end timestamptz NOT NULL, actual_completed_at timestamptz,
  status text DEFAULT 'planned', sync_provider text, sync_identifier text, created_at timestamptz DEFAULT now(),
  UNIQUE(user_id,sync_provider,sync_identifier)
);
CREATE TABLE labs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, title text NOT NULL,
  category text NOT NULL, domain text NOT NULL, difficulty text NOT NULL, safe boolean NOT NULL DEFAULT true,
  objective text NOT NULL, prerequisites jsonb NOT NULL DEFAULT '[]', authorization_note text NOT NULL,
  isolated_environment text NOT NULL, steps jsonb NOT NULL, validation_queries jsonb NOT NULL DEFAULT '[]',
  expected_result text NOT NULL, risks text NOT NULL, stop_criteria text NOT NULL,
  cleanup text NOT NULL, rollback text NOT NULL, tags text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users, lab_id uuid REFERENCES labs, kind text NOT NULL, storage_key text,
  note text, result text, approved_by uuid REFERENCES users, approved_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users, entity_type text NOT NULL, entity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'not_started', percent numeric(5,2) NOT NULL DEFAULT 0,
  started_at timestamptz, completed_at timestamptz, minutes_studied integer NOT NULL DEFAULT 0,
  notes text, updated_at timestamptz DEFAULT now(), UNIQUE(user_id,entity_type,entity_id)
);
CREATE TABLE readiness_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL, config jsonb NOT NULL, active boolean DEFAULT true, created_at timestamptz DEFAULT now()
);
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users, requested_by uuid REFERENCES users, format text NOT NULL,
  storage_key text, status text DEFAULT 'queued', signed_by uuid REFERENCES users,
  signed_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', read_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, team_id uuid, actor_id uuid, action text NOT NULL, entity_type text,
  entity_id text, data jsonb NOT NULL DEFAULT '{}', ip_hash text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid, type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz DEFAULT now(), locked_at timestamptz, last_error text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  source text NOT NULL, status text NOT NULL, checkpoint jsonb NOT NULL DEFAULT '{}', stats jsonb NOT NULL DEFAULT '{}',
  error text, started_at timestamptz DEFAULT now(), finished_at timestamptz
);
CREATE INDEX documents_team_category_idx ON documents(team_id,category);
CREATE INDEX attempts_user_created_idx ON attempts(user_id,created_at DESC);
CREATE INDEX progress_user_idx ON progress(user_id,entity_type);
CREATE INDEX audit_team_created_idx ON audit_log(team_id,created_at DESC);
CREATE INDEX jobs_poll_idx ON jobs(status,available_at);

-- O backend também filtra por equipe; estas políticas adicionam defesa em profundidade.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['documents','questions','reviews','simulations','attempts','goals','evidence','progress','readiness_rules','reports'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY team_scope_%I ON %I USING (team_id = nullif(current_setting(''app.team_id'', true), '''')::uuid) WITH CHECK (team_id = nullif(current_setting(''app.team_id'', true), '''')::uuid)', t, t);
  END LOOP;
END $$;
