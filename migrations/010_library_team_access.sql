ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS library_visibility text NOT NULL DEFAULT 'team_all';

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_library_visibility_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_library_visibility_check
  CHECK (library_visibility = 'team_all');

-- Todo documento da biblioteca é legível por membros autenticados da equipe.
UPDATE documents SET library_visibility = 'team_all';

CREATE INDEX IF NOT EXISTS documents_team_visibility_idx
  ON documents(team_id, library_visibility, title);
