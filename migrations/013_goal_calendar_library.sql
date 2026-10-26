-- Evolução aditiva: não altera sessões concluídas, progresso nem arquivos internos.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS planned_simulation_date date;

-- Corrige apenas metadados de links legados que nunca tiveram arquivo local.
UPDATE documents SET source_type='portal_link',is_public=false,requires_authentication=true,
  storage_permission='metadata_only',content_status='cataloged_metadata_only'
WHERE source_kind='official_catalog' AND local_path IS NULL AND NOT content_available
  AND source_url LIKE 'https://docs.crowdstrike.com/%';
UPDATE documents SET source_type='external_reference',storage_permission='metadata_only',
  content_status='cataloged_metadata_only'
WHERE source_kind='external_reference' AND local_path IS NULL AND NOT content_available;

-- Exam Guides públicos: somente metadados e URL; nenhum PDF é armazenado.
INSERT INTO documents(team_id,external_id,title,summary,category,product,language,source_url,
  canonical_url,source_kind,source_type,access_mode,is_public,requires_authentication,
  storage_permission,content_status,origin_confirmed,content_available,updated_date,review_status)
SELECT t.id,'exam-guide-'||ct.code,ct.code||' — Exam Guide',
  'Guia oficial da certificação '||ct.code||'. Consulte o PDF na fonte CrowdStrike; conteúdo não armazenado.',
  'Study Guides',ct.short_title,'en-US',ct.guide_url,ct.guide_url,
  'official_exam_guide','public_official','public',true,false,
  'metadata_only','cataloged_metadata_only',true,false,ct.guide_updated_on,'current'
FROM teams t CROSS JOIN certification_tracks ct
WHERE ct.guide_url LIKE 'https://www.crowdstrike.com/%'
ON CONFLICT(team_id,source_url) DO NOTHING;

INSERT INTO document_certifications(team_id,document_id,certification_id,relevance,rationale,mapping_source)
SELECT d.team_id,d.id,ct.id,'essential',
  'Guia oficial da própria certificação '||ct.code||'.','official_exam_guide'
FROM documents d JOIN certification_tracks ct ON d.source_url=ct.guide_url
WHERE d.source_kind='official_exam_guide'
ON CONFLICT(team_id,document_id,certification_id) DO NOTHING;
