ALTER TABLE goals ADD COLUMN IF NOT EXISTS version integer;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS previous_goal_id uuid REFERENCES goals(id) ON DELETE SET NULL;

WITH numbered AS (
  SELECT id,row_number() OVER (PARTITION BY user_id ORDER BY created_at,id)::integer AS version
  FROM goals
)
UPDATE goals g SET version=n.version FROM numbered n WHERE n.id=g.id AND g.version IS NULL;

ALTER TABLE goals ALTER COLUMN version SET DEFAULT 1;
ALTER TABLE goals ALTER COLUMN version SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_goals_user_version ON goals(user_id,version);

CREATE OR REPLACE FUNCTION assign_goal_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior goals%ROWTYPE;
BEGIN
  SELECT * INTO prior FROM goals WHERE user_id=NEW.user_id ORDER BY version DESC,created_at DESC LIMIT 1;
  IF FOUND THEN
    NEW.version := prior.version + 1;
    NEW.previous_goal_id := prior.id;
  ELSE
    NEW.version := 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assign_goal_version ON goals;
CREATE TRIGGER trg_assign_goal_version BEFORE INSERT ON goals FOR EACH ROW EXECUTE FUNCTION assign_goal_version();
