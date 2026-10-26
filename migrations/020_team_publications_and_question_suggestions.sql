CREATE TABLE IF NOT EXISTS question_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  certification_id uuid REFERENCES certification_tracks(id) ON DELETE SET NULL,
  category text,
  prompt text NOT NULL,
  proposed_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_note text,
  status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','in_review','accepted','rejected')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_suggestions_team_status_idx
  ON question_suggestions(team_id,status,created_at DESC);

ALTER TABLE question_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS question_suggestions_team ON question_suggestions;
CREATE POLICY question_suggestions_team ON question_suggestions
  USING(team_id=current_setting('app.team_id',true)::uuid)
  WITH CHECK(team_id=current_setting('app.team_id',true)::uuid);

UPDATE documents d SET library_visibility='team_all'
WHERE EXISTS (
  SELECT 1 FROM memberships m JOIN roles r ON r.id=m.role_id
  WHERE m.user_id=d.created_by AND m.team_id=d.team_id AND r.code='admin_reviewer'
);
