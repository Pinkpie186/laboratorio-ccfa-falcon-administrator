ALTER TABLE simulations ADD COLUMN IF NOT EXISTS certification_id uuid REFERENCES certification_tracks ON DELETE SET NULL;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS weekly_slot date;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS certification_id uuid REFERENCES certification_tracks ON DELETE SET NULL;
UPDATE goals SET certification_id=(SELECT id FROM certification_tracks WHERE code='CCFA')
WHERE certification_id IS NULL AND title ILIKE '%CCFA%';

-- Existing CCFA-coded questions remain scoped to CCFA; other tracks need reviewed mappings.
CREATE TABLE IF NOT EXISTS question_certifications (
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
  certification_id uuid NOT NULL REFERENCES certification_tracks ON DELETE CASCADE,
  mapping_source text NOT NULL DEFAULT 'reviewed',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,question_id,certification_id)
);
INSERT INTO question_certifications(team_id,question_id,certification_id,mapping_source)
SELECT q.team_id,q.id,ct.id,'question_code'
FROM questions q JOIN certification_tracks ct ON ct.code='CCFA'
WHERE q.question_code LIKE 'CCFA-%' OR q.objective='Preparação CCFA'
ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS question_certifications_track_idx
  ON question_certifications(team_id,certification_id,question_id);

-- A started full simulation reserves the calendar week, including an unfinished attempt.
WITH ranked AS (
  SELECT id,date_trunc('week',started_at AT TIME ZONE 'America/Sao_Paulo')::date slot,
    row_number() OVER(PARTITION BY user_id,date_trunc('week',started_at AT TIME ZONE 'America/Sao_Paulo') ORDER BY started_at,id) position
  FROM simulations WHERE mode='full' AND weekly_slot IS NULL
)
UPDATE simulations s SET weekly_slot=r.slot FROM ranked r WHERE s.id=r.id AND r.position=1;
CREATE UNIQUE INDEX IF NOT EXISTS simulations_one_full_per_user_week
  ON simulations(user_id,weekly_slot) WHERE mode='full' AND weekly_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS simulations_user_history_idx
  ON simulations(user_id,started_at DESC);

CREATE TABLE IF NOT EXISTS simulation_reports (
  simulation_id uuid PRIMARY KEY REFERENCES simulations ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE question_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS question_certifications_team ON question_certifications;
CREATE POLICY question_certifications_team ON question_certifications
  USING(team_id=current_setting('app.team_id',true)::uuid)
  WITH CHECK(team_id=current_setting('app.team_id',true)::uuid);
DROP POLICY IF EXISTS simulation_reports_team ON simulation_reports;
CREATE POLICY simulation_reports_team ON simulation_reports
  USING(team_id=current_setting('app.team_id',true)::uuid)
  WITH CHECK(team_id=current_setting('app.team_id',true)::uuid);
