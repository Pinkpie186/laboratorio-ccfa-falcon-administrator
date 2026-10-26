-- Compatibilidade aditiva com sessões legadas. O conteúdo detalhado continua em
-- notes e study_session_activities; title serve somente à leitura de sessões fixadas.
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS title text;

UPDATE study_sessions
SET title = notes
WHERE title IS NULL AND notes IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_study_session_title()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.title IS NULL THEN
    NEW.title := NEW.notes;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_study_session_title ON study_sessions;
CREATE TRIGGER trg_sync_study_session_title
BEFORE INSERT OR UPDATE OF notes, title ON study_sessions
FOR EACH ROW EXECUTE FUNCTION sync_study_session_title();
