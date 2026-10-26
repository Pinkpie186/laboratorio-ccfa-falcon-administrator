import pg from 'pg';

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL||'postgresql://postgres@127.0.0.1:55432/postgres',max:1});
try{
  const [translations,labs,mappings,documents,legacy]=await Promise.all([
    pool.query("SELECT count(*)::int total,count(DISTINCT q.id)::int questions,count(DISTINCT ct.code)::int certifications FROM question_translations qt JOIN questions q ON q.id=qt.question_id JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id JOIN certification_tracks ct ON ct.id=qc.certification_id WHERE qt.language='en-US' AND qt.translation_method='user_provided_english_edition'"),
    pool.query("SELECT count(*)::int total,count(DISTINCT certification_id)::int certifications,coalesce(sum(estimated_minutes),0)::int minutes FROM labs WHERE source_package='crowdstrike_certifications_en_2026-10-05'"),
    pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE question_id IS NOT NULL)::int resolved FROM lab_question_mappings"),
    pool.query("SELECT count(*)::int total FROM documents WHERE language='en-US' AND (category='Study Guides — English' OR category='Labs — English')"),
    pool.query("SELECT count(*)::int total FROM labs WHERE source_package IS NULL")
  ]);
  const report={translations:translations.rows[0],labs:labs.rows[0],mappings:mappings.rows[0],documents:documents.rows[0],legacyLabsPreserved:legacy.rows[0].total};
  if(report.translations.total!==480||report.translations.certifications!==8||report.labs.total!==32||report.labs.certifications!==8||
    report.mappings.total!==384||report.mappings.resolved!==384||report.documents.total!==18||report.legacyLabsPreserved<1){
    throw new Error(`English-package verification failed: ${JSON.stringify(report)}`);
  }
  console.log(JSON.stringify({status:'PASS',...report},null,2));
}finally{await pool.end();}
