CREATE TABLE IF NOT EXISTS certification_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL,
  title text NOT NULL, short_title text NOT NULL, description text NOT NULL,
  guide_url text NOT NULL, guide_updated_on date, program_url text NOT NULL,
  position integer NOT NULL, accent text NOT NULL DEFAULT '#ff5148', updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certification_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), certification_id uuid NOT NULL REFERENCES certification_tracks ON DELETE CASCADE,
  title text NOT NULL, position integer NOT NULL, UNIQUE(certification_id,title)
);

CREATE TABLE IF NOT EXISTS document_certifications (
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents ON DELETE CASCADE,
  certification_id uuid NOT NULL REFERENCES certification_tracks ON DELETE CASCADE,
  relevance text NOT NULL CHECK(relevance IN ('essential','supporting')),
  rationale text NOT NULL, mapping_source text NOT NULL DEFAULT 'official_exam_guide',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,document_id,certification_id)
);

CREATE TABLE IF NOT EXISTS certification_enrollments (
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  certification_id uuid NOT NULL REFERENCES certification_tracks ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','completed')),
  percent numeric(5,2) NOT NULL DEFAULT 0 CHECK(percent BETWEEN 0 AND 100), target_date date,
  started_at timestamptz, completed_at timestamptz, is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,certification_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS certification_enrollments_one_active
  ON certification_enrollments(user_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS document_certifications_lookup
  ON document_certifications(team_id,certification_id,relevance);

ALTER TABLE document_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_certifications_team ON document_certifications;
CREATE POLICY document_certifications_team ON document_certifications USING(team_id=current_setting('app.team_id',true)::uuid) WITH CHECK(team_id=current_setting('app.team_id',true)::uuid);
DROP POLICY IF EXISTS certification_enrollments_team ON certification_enrollments;
CREATE POLICY certification_enrollments_team ON certification_enrollments USING(team_id=current_setting('app.team_id',true)::uuid) WITH CHECK(team_id=current_setting('app.team_id',true)::uuid);
