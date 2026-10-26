ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS certification_id uuid REFERENCES certification_tracks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reports_team_certification_created_idx
  ON reports(team_id, certification_id, created_at DESC);
