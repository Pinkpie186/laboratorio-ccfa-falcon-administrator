-- Labs do caderno prático em inglês, vinculados à trilha e às questões do guia.
-- As colunas são opcionais para preservar integralmente os labs legados.
ALTER TABLE labs ADD COLUMN IF NOT EXISTS certification_id uuid REFERENCES certification_tracks(id) ON DELETE SET NULL;
ALTER TABLE labs ADD COLUMN IF NOT EXISTS content_language text NOT NULL DEFAULT 'pt-BR';
ALTER TABLE labs ADD COLUMN IF NOT EXISTS source_package text;
ALTER TABLE labs ADD COLUMN IF NOT EXISTS source_document_path text;
ALTER TABLE labs ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE labs ADD COLUMN IF NOT EXISTS fixture_files jsonb NOT NULL DEFAULT '[]';
ALTER TABLE labs ADD COLUMN IF NOT EXISTS question_numbers jsonb NOT NULL DEFAULT '[]';
ALTER TABLE labs ADD COLUMN IF NOT EXISTS reference_topics jsonb NOT NULL DEFAULT '[]';
ALTER TABLE labs ADD COLUMN IF NOT EXISTS evidence_requirements text;
ALTER TABLE labs ADD COLUMN IF NOT EXISTS console_extension text;
ALTER TABLE labs ADD COLUMN IF NOT EXISTS rubric jsonb NOT NULL DEFAULT '[]';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='labs_content_language_check') THEN
    ALTER TABLE labs ADD CONSTRAINT labs_content_language_check
      CHECK(content_language IN ('pt-BR','en-US'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='labs_estimated_minutes_check') THEN
    ALTER TABLE labs ADD CONSTRAINT labs_estimated_minutes_check
      CHECK(estimated_minutes IS NULL OR estimated_minutes BETWEEN 5 AND 480);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lab_question_mappings (
  lab_id uuid NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  certification_id uuid NOT NULL REFERENCES certification_tracks(id) ON DELETE CASCADE,
  question_number integer NOT NULL CHECK(question_number BETWEEN 1 AND 200),
  question_id uuid REFERENCES questions(id) ON DELETE SET NULL,
  mapping_source text NOT NULL DEFAULT 'user_provided_lab_map',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(lab_id,certification_id,question_number)
);

CREATE INDEX IF NOT EXISTS labs_certification_language_idx
  ON labs(certification_id,content_language,source_package,code);
CREATE INDEX IF NOT EXISTS lab_question_mappings_question_idx
  ON lab_question_mappings(question_id) WHERE question_id IS NOT NULL;
