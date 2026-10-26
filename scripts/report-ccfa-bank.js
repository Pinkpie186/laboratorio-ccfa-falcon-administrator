import { pool } from '../src/db.js';

const team=(await pool.query("SELECT id FROM teams WHERE slug=$1",[process.env.IMPORT_TEAM_SLUG||'equipe-demo'])).rows[0];
if(!team)throw new Error('Equipe não encontrada.');
const [domains,difficulties,formats,statuses,documents,blueprints,external,samples]=await Promise.all([
  pool.query("SELECT official_domain label,count(*)::int total FROM questions WHERE team_id=$1 AND question_code LIKE 'CCFA-2026-%' GROUP BY official_domain ORDER BY official_domain",[team.id]),
  pool.query("SELECT difficulty label,count(*)::int total FROM questions WHERE team_id=$1 AND question_code LIKE 'CCFA-2026-%' GROUP BY difficulty ORDER BY difficulty",[team.id]),
  pool.query("SELECT format label,count(*)::int total FROM questions WHERE team_id=$1 AND question_code LIKE 'CCFA-2026-%' GROUP BY format ORDER BY format",[team.id]),
  pool.query("SELECT status label,count(*)::int total FROM questions WHERE team_id=$1 AND question_code LIKE 'CCFA-2026-%' GROUP BY status ORDER BY status",[team.id]),
  pool.query("SELECT DISTINCT qs.source_title title,qs.source_version version FROM questions q JOIN question_sources qs ON qs.question_id=q.id WHERE q.team_id=$1 AND q.question_code LIKE 'CCFA-2026-%' ORDER BY qs.source_title",[team.id]),
  pool.query("SELECT code,title,question_count,duration_minutes FROM quiz_blueprints WHERE team_id=$1 AND active ORDER BY question_count,code",[team.id]),
  pool.query("SELECT title,url,warning,content_stored,technical_source_allowed FROM external_topic_references WHERE team_id=$1",[team.id]),
  pool.query(`SELECT DISTINCT ON(q.official_domain) q.question_code,q.official_domain,q.difficulty,q.format,q.prompt,q.options,q.correct_answer,q.explanation,qs.source_title,qs.source_version,qs.page_number,qs.section,qs.source_url FROM questions q JOIN question_sources qs ON qs.question_id=q.id WHERE q.team_id=$1 AND q.question_code LIKE 'CCFA-2026-%' AND q.official_domain IN ('User Management','Sensor Deployment','Workflows') ORDER BY q.official_domain,q.question_code`,[team.id])
]);
console.log(JSON.stringify({domains:domains.rows,difficulties:difficulties.rows,formats:formats.rows,statuses:statuses.rows,documents:documents.rows,blueprints:blueprints.rows,external:external.rows,rejected:{insufficientEvidence:0,similarity:0},samples:samples.rows},null,2));
await pool.end();
