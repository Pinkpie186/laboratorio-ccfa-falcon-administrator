ALTER TABLE courses ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
-- Contagens antigas eram placeholders, não nomes confirmados pela University.
UPDATE courses SET official_module_count = NULL;

ALTER TABLE submodules ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'not_started';
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams ON DELETE CASCADE;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS percent numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS minutes_studied integer NOT NULL DEFAULT 0;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE submodules ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE goals ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT 'Certificação CCFA';
ALTER TABLE goals ADD COLUMN IF NOT EXISTS target_score integer NOT NULL DEFAULT 80;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS weekly_minutes integer NOT NULL DEFAULT 225;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS final_review_days integer NOT NULL DEFAULT 7;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE goals ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE availability ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES goals ON DELETE CASCADE;

CREATE TABLE availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE CASCADE, goal_id uuid REFERENCES goals ON DELETE CASCADE,
  exception_date date NOT NULL, available boolean NOT NULL DEFAULT false,
  start_time time, end_time time, session_minutes integer, reason text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(goal_id,exception_date)
);

CREATE TABLE query_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL,
  level integer NOT NULL, title text NOT NULL, body text NOT NULL,
  source_url text NOT NULL, position integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE query_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL,
  exercise_type text NOT NULL, domain text NOT NULL DEFAULT 'Queries / CQL',
  prompt text NOT NULL, options jsonb NOT NULL, correct_answer integer NOT NULL,
  explanation text NOT NULL, source_url text NOT NULL, position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE query_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE CASCADE, exercise_id uuid REFERENCES query_exercises ON DELETE CASCADE,
  selected_answer integer NOT NULL, correct boolean NOT NULL, points integer NOT NULL DEFAULT 0,
  elapsed_seconds integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telemetry_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL,
  lab_id uuid REFERENCES labs ON DELETE SET NULL, level text NOT NULL, title text NOT NULL,
  marker text NOT NULL, focus text NOT NULL, prerequisites jsonb NOT NULL DEFAULT '[]',
  commands jsonb NOT NULL DEFAULT '[]', expected_result text NOT NULL,
  expected_evidence text NOT NULL, risk text NOT NULL, rollback text NOT NULL,
  stop_criteria text NOT NULL, query_template text NOT NULL, script_path text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lab_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE CASCADE, lab_id uuid REFERENCES labs ON DELETE CASCADE,
  telemetry_test_id uuid REFERENCES telemetry_tests ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned', events_found boolean NOT NULL DEFAULT false,
  quarantine_observed boolean NOT NULL DEFAULT false, query_correct boolean NOT NULL DEFAULT false,
  cleanup_status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 1,
  score numeric(5,2) NOT NULL DEFAULT 0, evidence_note text, observations text,
  started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE glossary_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL,
  term_pt text NOT NULL, term_en text NOT NULL, definition text NOT NULL,
  category text NOT NULL DEFAULT 'Administração Falcon', source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE CASCADE, course_id uuid REFERENCES courses ON DELETE SET NULL,
  submodule_id uuid REFERENCES submodules ON DELETE SET NULL, activity_type text NOT NULL,
  planned_minutes integer NOT NULL DEFAULT 0, actual_minutes integer NOT NULL DEFAULT 0,
  planned_at timestamptz, started_at timestamptz, completed_at timestamptz,
  notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE review_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE CASCADE, entity_type text NOT NULL, entity_id uuid NOT NULL,
  interval_days integer NOT NULL, due_at timestamptz NOT NULL, completed_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,entity_type,entity_id,interval_days,due_at)
);
CREATE TABLE course_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid REFERENCES teams ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE CASCADE, course_id uuid REFERENCES courses ON DELETE CASCADE,
  challenge_type text NOT NULL, reference_id uuid, attempts integer NOT NULL DEFAULT 0,
  score numeric(5,2) NOT NULL DEFAULT 0, evidence_id uuid REFERENCES evidence ON DELETE SET NULL,
  observations text, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX query_attempts_user_idx ON query_attempts(user_id,created_at DESC);
CREATE INDEX lab_runs_user_idx ON lab_runs(user_id,updated_at DESC);
CREATE INDEX review_schedule_due_idx ON review_schedule(user_id,status,due_at);
CREATE INDEX study_sessions_user_idx ON study_sessions(user_id,created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['availability_exceptions','query_attempts','lab_runs','study_sessions','review_schedule','course_challenges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY team_scope_%I ON %I USING (team_id = nullif(current_setting(''app.team_id'', true), '''')::uuid) WITH CHECK (team_id = nullif(current_setting(''app.team_id'', true), '''')::uuid)', t, t);
  END LOOP;
END $$;
