-- Evolução aditiva: preserva calendários, questões, tentativas e progresso anteriores.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS min_session_minutes integer NOT NULL DEFAULT 20;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS max_session_minutes integer NOT NULL DEFAULT 90;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS max_daily_minutes integer NOT NULL DEFAULT 180;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS max_weekly_minutes integer NOT NULL DEFAULT 600;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS preferred_period text NOT NULL DEFAULT 'evening';
ALTER TABLE goals ADD COLUMN IF NOT EXISTS session_gap_minutes integer NOT NULL DEFAULT 15;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS intensity text NOT NULL DEFAULT 'balanced';
ALTER TABLE goals ADD COLUMN IF NOT EXISTS weekends_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE availability ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE availability ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES schedules ON DELETE SET NULL;
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned';
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS planned_start timestamptz;
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS planned_end timestamptz;
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 3;
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS fixed_by_user boolean NOT NULL DEFAULT false;
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS sync_identifier text;
CREATE UNIQUE INDEX IF NOT EXISTS study_sessions_sync_identifier_idx ON study_sessions(user_id,sync_identifier) WHERE sync_identifier IS NOT NULL;

CREATE TABLE IF NOT EXISTS study_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  course_id uuid REFERENCES courses ON DELETE SET NULL, submodule_id uuid REFERENCES submodules ON DELETE SET NULL,
  activity_type text NOT NULL, title text NOT NULL, objective text NOT NULL, topic text NOT NULL,
  instructions text NOT NULL, key_concepts jsonb NOT NULL DEFAULT '[]', completion_criteria text NOT NULL,
  deliverable text, estimated_minutes integer NOT NULL CHECK(estimated_minutes>0), priority smallint NOT NULL DEFAULT 3,
  prerequisite_order integer NOT NULL DEFAULT 0, document_id uuid REFERENCES documents ON DELETE SET NULL,
  version_id uuid REFERENCES document_versions ON DELETE SET NULL, page_number integer, section text,
  excerpt text, question_category text, question_count integer, query_exercise_id uuid REFERENCES query_exercises ON DELETE SET NULL,
  lab_id uuid REFERENCES labs ON DELETE SET NULL, curator_status text NOT NULL DEFAULT 'ready', source_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id,source_fingerprint)
);

CREATE TABLE IF NOT EXISTS study_session_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES study_sessions ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES study_activities ON DELETE RESTRICT,
  position integer NOT NULL, planned_minutes integer NOT NULL CHECK(planned_minutes>0), split_part integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'planned', started_at timestamptz, completed_at timestamptz, actual_minutes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(session_id,position)
);

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS study_session_id uuid REFERENCES study_sessions ON DELETE SET NULL;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 3;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS color_key text;

CREATE TABLE IF NOT EXISTS plan_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, goal_id uuid NOT NULL REFERENCES goals ON DELETE CASCADE,
  payload jsonb NOT NULL, total_required_minutes integer NOT NULL, total_available_minutes integer NOT NULL,
  feasible boolean NOT NULL, conflicts jsonb NOT NULL DEFAULT '[]', expires_at timestamptz NOT NULL,
  applied_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_change_history (
  id bigserial PRIMARY KEY, team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, session_id uuid REFERENCES study_sessions ON DELETE SET NULL,
  action text NOT NULL, before_state jsonb, after_state jsonb, reason text, created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE questions ADD COLUMN IF NOT EXISTS distractor_explanations jsonb NOT NULL DEFAULT '[]';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS ccfa_objective text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS generated_at timestamptz;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS reviewer_id uuid REFERENCES users ON DELETE SET NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS possible_stale boolean NOT NULL DEFAULT false;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS content_fingerprint text;
CREATE UNIQUE INDEX IF NOT EXISTS questions_team_fingerprint_idx ON questions(team_id,content_fingerprint) WHERE content_fingerprint IS NOT NULL;

ALTER TABLE simulations ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS last_autosave_at timestamptz;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS current_position integer NOT NULL DEFAULT 1;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS preview_mode boolean NOT NULL DEFAULT false;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS paused_seconds integer NOT NULL DEFAULT 0;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE answers ADD COLUMN IF NOT EXISTS confidence smallint;
ALTER TABLE answers ADD COLUMN IF NOT EXISTS marked_for_review boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS simulation_events (
  id bigserial PRIMARY KEY, team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  simulation_id uuid NOT NULL REFERENCES simulations ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  event_type text NOT NULL, position integer, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS ranking_alias text;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS hide_ranking_name boolean NOT NULL DEFAULT false;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS ranking_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS ranking_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS point_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  code text NOT NULL, label text NOT NULL, points integer NOT NULL CHECK(points>=0), daily_cap integer,
  enabled boolean NOT NULL DEFAULT true, config jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id,code)
);
CREATE TABLE IF NOT EXISTS point_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, rule_id uuid NOT NULL REFERENCES point_rules ON DELETE RESTRICT,
  source_type text NOT NULL, source_id text NOT NULL, points integer NOT NULL, idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}', corrected_by uuid REFERENCES users ON DELETE SET NULL,
  correction_reason text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(team_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  code text NOT NULL, title text NOT NULL, description text NOT NULL, icon text NOT NULL DEFAULT '◆',
  criteria jsonb NOT NULL DEFAULT '{}', enabled boolean NOT NULL DEFAULT true, UNIQUE(team_id,code)
);
CREATE TABLE IF NOT EXISTS user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, achievement_id uuid NOT NULL REFERENCES achievements ON DELETE CASCADE,
  source_event_id uuid REFERENCES point_events ON DELETE SET NULL, earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,achievement_id)
);

CREATE INDEX IF NOT EXISTS study_sessions_user_start_idx ON study_sessions(user_id,planned_start);
CREATE INDEX IF NOT EXISTS study_activities_team_type_idx ON study_activities(team_id,activity_type);
CREATE INDEX IF NOT EXISTS session_activities_session_idx ON study_session_activities(session_id,position);
CREATE INDEX IF NOT EXISTS questions_editorial_idx ON questions(team_id,status,category,difficulty);
CREATE INDEX IF NOT EXISTS point_events_team_user_idx ON point_events(team_id,user_id,created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['study_activities','study_session_activities','plan_previews','calendar_change_history','simulation_events','ranking_seasons','point_rules','point_events','achievements','user_achievements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='team_scope_'||t) THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (team_id=nullif(current_setting(''app.team_id'',true),'''')::uuid) WITH CHECK (team_id=nullif(current_setting(''app.team_id'',true),'''')::uuid)','team_scope_'||t,t);
    END IF;
  END LOOP;
END $$;
