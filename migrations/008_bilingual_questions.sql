-- Idioma de estudo por usuário e versão linguística congelada no simulado.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_question_language text NOT NULL DEFAULT 'pt-BR';

ALTER TABLE simulations
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'pt-BR';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_question_language_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_question_language_check
      CHECK(preferred_question_language IN ('pt-BR','en-US'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='simulations_language_check') THEN
    ALTER TABLE simulations ADD CONSTRAINT simulations_language_check
      CHECK(language IN ('pt-BR','en-US'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS question_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
  language text NOT NULL CHECK(language IN ('pt-BR','en-US')),
  prompt text NOT NULL,
  options jsonb NOT NULL,
  explanation text NOT NULL,
  distractor_explanations jsonb NOT NULL DEFAULT '[]',
  translation_status text NOT NULL DEFAULT 'reviewed'
    CHECK(translation_status IN ('draft','review','reviewed')),
  translation_method text NOT NULL DEFAULT 'manual',
  reviewed_by uuid REFERENCES users ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(question_id,language)
);

CREATE INDEX IF NOT EXISTS question_translations_language_idx
  ON question_translations(language,question_id);

-- As questões citadas foram geradas com enunciado/explicação padronizados.
-- As alternativas são trechos oficiais em inglês e permanecem sem paráfrase.
INSERT INTO question_translations(
  question_id,language,prompt,options,explanation,distractor_explanations,
  translation_status,translation_method,reviewed_at
)
SELECT q.id,'en-US',
  'Based exclusively on “'||qs.source_title||'” ('||
    CASE WHEN qs.page_number IS NOT NULL THEN 'page '||qs.page_number::text
         ELSE 'section '||COALESCE(qs.section,'not specified') END||
    '), which option matches the documented content?',
  q.options,
  'The correct answer is option '||chr(65+(q.correct_answer::text)::integer)||
    ' because it exactly matches the validated evidence in '||
    CASE WHEN qs.page_number IS NOT NULL THEN 'page '||qs.page_number::text
         ELSE 'section '||COALESCE(qs.section,'not specified') END||'.',
  q.distractor_explanations,
  'reviewed','deterministic_template',now()
FROM questions q
JOIN LATERAL (
  SELECT source_title,page_number,section
  FROM question_sources
  WHERE question_id=q.id AND validation_status='validated_content'
  ORDER BY consulted_at DESC LIMIT 1
) qs ON true
WHERE q.generated_by_ai
  AND jsonb_typeof(q.correct_answer)='number'
  AND jsonb_array_length(q.options)>=2
ON CONFLICT(question_id,language) DO NOTHING;
