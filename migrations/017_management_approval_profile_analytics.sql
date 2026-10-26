ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_key text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_mime text;

ALTER TABLE simulations ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'not_required';
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users ON DELETE SET NULL;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS rejection_reason text;

DO $$ BEGIN
  ALTER TABLE simulations ADD CONSTRAINT simulations_approval_status_check
    CHECK (approval_status IN ('not_required','pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS simulation_approval_events (
  id bigserial PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  simulation_id uuid NOT NULL REFERENCES simulations ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users ON DELETE RESTRICT,
  decision text NOT NULL CHECK(decision IN ('approved','rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS simulation_approval_queue_idx
  ON simulations(team_id,approval_status,submitted_at DESC);
CREATE INDEX IF NOT EXISTS simulation_approval_events_sim_idx
  ON simulation_approval_events(simulation_id,created_at DESC);

ALTER TABLE simulation_approval_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulation_approval_events_team ON simulation_approval_events;
CREATE POLICY simulation_approval_events_team ON simulation_approval_events
  USING(team_id=current_setting('app.team_id',true)::uuid)
  WITH CHECK(team_id=current_setting('app.team_id',true)::uuid);
