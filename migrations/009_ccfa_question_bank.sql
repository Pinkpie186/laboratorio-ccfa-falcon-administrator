ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_status_check;
ALTER TABLE questions ADD CONSTRAINT questions_status_check
  CHECK(status IN ('draft','review','correction_requested','approved','published','revalidate','archived','rejected'));

ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_code text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS official_domain text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS official_subobjective text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS correct_count smallint NOT NULL DEFAULT 1;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS competency text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS external_inspired boolean NOT NULL DEFAULT false;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS external_similarity numeric(5,4);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS normalized_text_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS questions_team_code_idx ON questions(team_id,question_code) WHERE question_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS questions_blueprint_idx ON questions(team_id,official_domain,difficulty,format,status);

CREATE TABLE IF NOT EXISTS question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
  language text NOT NULL CHECK(language IN ('pt-BR','en-US')),
  option_index smallint NOT NULL CHECK(option_index BETWEEN 0 AND 9),
  option_text text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(question_id,language,option_index)
);

CREATE TABLE IF NOT EXISTS question_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_reason text,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(question_id,version)
);

CREATE TABLE IF NOT EXISTS question_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
  flag_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','blocking')),
  details jsonb NOT NULL DEFAULT '{}',
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_metrics (
  question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
  question_version integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  correct_rate numeric(6,3),
  observed_difficulty numeric(6,3),
  avg_seconds numeric(10,2),
  abandonment_rate numeric(6,3),
  discrimination numeric(7,4),
  option_frequency jsonb NOT NULL DEFAULT '{}',
  reports integer NOT NULL DEFAULT 0,
  confidence_accuracy jsonb NOT NULL DEFAULT '{}',
  ambiguity_score numeric(7,4),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(question_id,question_version)
);

CREATE TABLE IF NOT EXISTS external_topic_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  consulted_at timestamptz NOT NULL,
  warning text NOT NULL,
  themes jsonb NOT NULL DEFAULT '[]',
  content_stored boolean NOT NULL DEFAULT false,
  technical_source_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id,url)
);

CREATE TABLE IF NOT EXISTS quiz_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  mode text NOT NULL,
  question_count integer NOT NULL CHECK(question_count BETWEEN 1 AND 60),
  duration_minutes integer,
  filters jsonb NOT NULL DEFAULT '{}',
  internal_target_score integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id,code)
);

CREATE TABLE IF NOT EXISTS confidence_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id uuid NOT NULL REFERENCES answers ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(answer_id,user_id)
);

ALTER TABLE simulations ADD COLUMN IF NOT EXISTS blueprint_id uuid REFERENCES quiz_blueprints ON DELETE SET NULL;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS internal_target_score integer;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS source_label text;

CREATE INDEX IF NOT EXISTS question_flags_open_idx ON question_flags(team_id,question_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS external_topic_reference_team_idx ON external_topic_references(team_id,consulted_at DESC);
