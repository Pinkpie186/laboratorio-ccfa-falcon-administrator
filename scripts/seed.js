import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
import { hashPassword, sha256 } from '../src/security.js';
import { ensureCertificationCatalog, mapDocumentsToCertifications } from '../src/certifications.js';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const courses=[
 ['FALCON 100','Platform Architecture Overview',30,1],['FALCON 101','Platform Essentials',50,2],['FALCON 102','Platform Onboarding Configuration',120,3],
 ['FALCON 104','Getting Started with Endpoint Security',25,4],['FALCON 105','Sensor Installation, Configuration and Troubleshooting',45,5],
 ['FALCON 106','Customizing Dashboards in Falcon',20,6],['FALCON 107','Falcon Firewall Management Fundamentals',15,7],
 ['SOAR 100','Falcon Fusion SOAR Fundamentals',45,8],['FALCON 160','Falcon for Mobile',15,9],
 ['ITSEC 121','Vulnerability Management Fundamentals',40,10],['ITSEC 122','Asset Management Fundamentals',40,11],
 ['ILT','Falcon Administrator ILT Courses',0,12]
];
const learning=JSON.parse(await fs.readFile(path.join(base,'seed/learning-content.json'),'utf8'));
const learningCourses=new Map(learning.courses.map(item=>[item.code,item]));
const querySource='https://library.humio.com/data-analysis/syntax.html';
const client=await pool.connect();
try{
 await client.query('BEGIN');
 await ensureCertificationCatalog(client);
 for(const [code,title,duration,position] of courses){const meta=learningCourses.get(code);await client.query(`INSERT INTO courses(code,title,duration_minutes,position,official_url,official_module_count,source_note,tags,summary,learning_topics,summary_source_url,summary_consulted_at) VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$5,$10) ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,duration_minutes=EXCLUDED.duration_minutes,position=EXCLUDED.position,official_url=EXCLUDED.official_url,source_note=EXCLUDED.source_note,tags=EXCLUDED.tags,summary=EXCLUDED.summary,learning_topics=EXCLUDED.learning_topics,summary_source_url=EXCLUDED.summary_source_url,summary_consulted_at=EXCLUDED.summary_consulted_at`,[code,title,duration,position,'https://university.crowdstrike.com/learn/learning-plans/111/falcon-administrator','Os 12 cursos pertencem ao plano oficial Falcon Administrator. Submódulos internos somente por importação autorizada ou cadastro manual.',meta?.tags||[],meta?.summary||null,meta?.topics||[],'2026-10-05']);}
 // Syllabus metadata confirmed in the authenticated University course indexes.
 // This additive pass never updates user progress, dates, study sessions, or notes.
 for(const meta of learning.courses){
  const course=(await client.query('UPDATE courses SET official_module_count=$1 WHERE code=$2 RETURNING id',[meta.modules?.length||null,meta.code])).rows[0];
  if(!course)continue;
  for(const [moduleIndex,moduleTitle] of (meta.modules||[]).entries())await client.query(`INSERT INTO submodules(course_id,title,position,source_type,notes,source_url,verified_at) VALUES($1,$2,$3,'authorized_import',$4,$5,$6) ON CONFLICT(course_id,title) DO UPDATE SET position=EXCLUDED.position,source_type='authorized_import',source_url=EXCLUDED.source_url,verified_at=COALESCE(submodules.verified_at,EXCLUDED.verified_at)`,[course.id,moduleTitle,moduleIndex+1,'Titulo confirmado no indice autenticado da CrowdStrike University em 05/10/2026.','https://university.crowdstrike.com/learn/learning-plans/111/falcon-administrator','2026-10-05T12:00:00-03:00']);
 }
 for(const [i,item] of learning.labs.entries()){
  const code=`LAB-${String(i+1).padStart(2,'0')}`;
  const related=learning.telemetry.filter(test=>test.labRef===item.id);
  const queries=related.map(test=>test.query);
  const stops=[...new Set(related.map(test=>test.stop))];
  await client.query(`INSERT INTO labs(code,title,category,domain,difficulty,objective,prerequisites,authorization_note,isolated_environment,steps,validation_queries,expected_result,risks,stop_criteria,cleanup,rollback,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,category=EXCLUDED.category,domain=EXCLUDED.domain,difficulty=EXCLUDED.difficulty,objective=EXCLUDED.objective,prerequisites=EXCLUDED.prerequisites,authorization_note=EXCLUDED.authorization_note,isolated_environment=EXCLUDED.isolated_environment,steps=EXCLUDED.steps,validation_queries=EXCLUDED.validation_queries,expected_result=EXCLUDED.expected_result,risks=EXCLUDED.risks,stop_criteria=EXCLUDED.stop_criteria,cleanup=EXCLUDED.cleanup,rollback=EXCLUDED.rollback,tags=EXCLUDED.tags`,[
   code,item.title,item.category,item.category,i<5?'básico':i<13?'intermediário':'avançado',item.objective,JSON.stringify(item.prereq),'Aprovação explícita do proprietário do tenant e change quando aplicável.','Tenant de teste e VM/grupo isolado; nunca a máquina principal.',JSON.stringify(item.steps),JSON.stringify(queries),item.evidence,item.risks,stops.join(' ')||'Interromper diante de impacto, escopo inesperado, solicitação de segredo ou comportamento não previsto.',item.cleanup,item.cleanup,[item.category.toLowerCase(),'seguro','tenant-teste']
  ]);
 }
 for(const [i,item] of learning.telemetry.entries()){
  const labCode=`LAB-${String(Number(item.labRef.replace('lab',''))).padStart(2,'0')}`;
  await client.query(`INSERT INTO telemetry_tests(code,lab_id,level,title,marker,focus,prerequisites,commands,expected_result,expected_evidence,risk,rollback,stop_criteria,query_template,script_path,tags) SELECT $1,l.id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15 FROM labs l WHERE l.code=$16 ON CONFLICT(code) DO UPDATE SET lab_id=EXCLUDED.lab_id,level=EXCLUDED.level,title=EXCLUDED.title,marker=EXCLUDED.marker,focus=EXCLUDED.focus,prerequisites=EXCLUDED.prerequisites,commands=EXCLUDED.commands,expected_result=EXCLUDED.expected_result,expected_evidence=EXCLUDED.expected_evidence,risk=EXCLUDED.risk,rollback=EXCLUDED.rollback,stop_criteria=EXCLUDED.stop_criteria,query_template=EXCLUDED.query_template,script_path=EXCLUDED.script_path,tags=EXCLUDED.tags`,[
   `TELE-${String(i+1).padStart(2,'0')}`,item.level,item.title,item.marker,item.focus,JSON.stringify(item.prereq),JSON.stringify(item.commands),item.expected,item.evidence,item.risk,item.rollback,item.stop,item.query,`safe-tests/linux/${item.script}`,[item.focus,'linux','seguro'],labCode
  ]);
 }
 for(const [i,item] of learning.queryGuide.entries())await client.query(`INSERT INTO query_lessons(code,level,title,body,source_url,position) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(code) DO UPDATE SET level=EXCLUDED.level,title=EXCLUDED.title,body=EXCLUDED.body,source_url=EXCLUDED.source_url,position=EXCLUDED.position`,[`QUERY-GUIDE-${i+1}`,Number(item.level),item.title,item.body,querySource,i+1]);
 for(const [i,item] of learning.queryExercises.entries())await client.query(`INSERT INTO query_exercises(code,exercise_type,prompt,options,correct_answer,explanation,source_url,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(code) DO UPDATE SET exercise_type=EXCLUDED.exercise_type,prompt=EXCLUDED.prompt,options=EXCLUDED.options,correct_answer=EXCLUDED.correct_answer,explanation=EXCLUDED.explanation,source_url=EXCLUDED.source_url,position=EXCLUDED.position`,[item.id.toUpperCase(),item.type,item.prompt,JSON.stringify(item.options),item.answer,item.explanation,querySource,i+1]);
 for(const item of learning.glossary){const [pt,en,definition]=item;const slug=pt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');await client.query(`INSERT INTO glossary_terms(slug,term_pt,term_en,definition,source_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(slug) DO UPDATE SET term_pt=EXCLUDED.term_pt,term_en=EXCLUDED.term_en,definition=EXCLUDED.definition,source_url=EXCLUDED.source_url`,[slug,pt,en,definition,'https://www.crowdstrike.com/resources/']);}
 const team=(await client.query("INSERT INTO teams(name,slug) VALUES('Equipe Demo Fictícia','equipe-demo') ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id")).rows[0];
 await client.query("SELECT set_config('app.team_id',$1,true)",[team.id]);
 const email='revisor.demo@example.invalid'; let user=(await client.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];
 if(!user){const password=process.env.DEMO_REVIEWER_PASSWORD;if(!password||password.length<12)throw new Error('Defina DEMO_REVIEWER_PASSWORD (mínimo 12 caracteres) no ambiente privado antes do primeiro seed.');user=(await client.query('INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',[email,'Revisor Demo',await hashPassword(password)])).rows[0];}
 await client.query("INSERT INTO memberships(team_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE code='admin_reviewer' ON CONFLICT(team_id,user_id) DO NOTHING",[team.id,user.id]);
 const analystEmail='aluno.demo@example.invalid';let analyst=(await client.query('SELECT id FROM users WHERE email=$1',[analystEmail])).rows[0];
 if(!analyst){const password=process.env.DEMO_ANALYST_PASSWORD;if(!password||password.length<12)throw new Error('Defina DEMO_ANALYST_PASSWORD (mínimo 12 caracteres) no ambiente privado antes do primeiro seed.');analyst=(await client.query('INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',[analystEmail,'Aluno Demo',await hashPassword(password)])).rows[0];}
 await client.query("INSERT INTO memberships(team_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE code='analyst' ON CONFLICT(team_id,user_id) DO NOTHING",[team.id,analyst.id]);
 const catalog=JSON.parse(await fs.readFile(path.join(base,'data/official-catalog.json'),'utf8')); let cataloged=0;
 for(const item of catalog.documents){const row=(await client.query(`INSERT INTO documents(team_id,external_id,title,category,product,language,source_url,source_kind,access_mode,publication_date,synchronized_at,created_by) VALUES($1,$2,$3,$4,$5,'pt-BR',$6,'official_catalog','portal_only',$7,$8,$9) ON CONFLICT(team_id,source_url) DO UPDATE SET title=EXCLUDED.title,category=EXCLUDED.category,product=EXCLUDED.product,publication_date=EXCLUDED.publication_date,synchronized_at=EXCLUDED.synchronized_at RETURNING id`,[team.id,item.externalId,item.title,item.category,item.product,item.url,item.published||null,catalog.capturedAt,user.id])).rows[0];const digest=sha256(JSON.stringify(item));const version=(await client.query(`INSERT INTO document_versions(document_id,version_label,sha256,mime_type,byte_size,extraction_status,metadata) VALUES($1,$2,$3,'text/html',0,'metadata_only',$4) ON CONFLICT(document_id,sha256) DO UPDATE SET metadata=EXCLUDED.metadata RETURNING id`,[row.id,item.version||null,digest,JSON.stringify({portalOnly:true,reason:'Consulta no portal CrowdStrike; texto não exportado.'})])).rows[0];await client.query('UPDATE documents SET current_version_id=$1 WHERE id=$2',[version.id,row.id]);cataloged++;}
 await client.query(`INSERT INTO documents(team_id,external_id,title,category,product,language,source_url,source_kind,access_mode,synchronized_at,created_by) VALUES($1,'external-dump-reference','Dump externo — não oficial e não validado','Dump externo — não oficial e não validado','Terceiros','pt-BR','https://www.dumpsbase.com/freedumps/new-ccfa-200b-dumps-v8-02-just-released-for-crowdstrike-certified-falcon-administrator-ccfa-exam-preparation-check-ccfa-200b-free-dumps-part-1-q1-q40-first.html','external_reference','link_only',now(),$2) ON CONFLICT(team_id,source_url) DO NOTHING`,[team.id,user.id]);
 const legacy=JSON.parse(await fs.readFile(path.join(base,'seed/questions.json'),'utf8'));let drafted=0;
 for(const item of legacy){await client.query(`INSERT INTO questions(team_id,author_id,category,difficulty,format,objective,prompt,options,correct_answer,explanation,status,generated_by_ai) SELECT $1,$2,$3,$4,'multiple_choice','Preparação CCFA',$5,$6,$7,$8,'review',false WHERE NOT EXISTS(SELECT 1 FROM questions WHERE team_id=$1 AND prompt=$5)`,[team.id,user.id,item.domain,item.difficulty.toLowerCase(),item.prompt,JSON.stringify(item.options),JSON.stringify(item.answer),item.explanation]);drafted++;}
 await client.query(`INSERT INTO question_certifications(team_id,question_id,certification_id,mapping_source)
   SELECT q.team_id,q.id,ct.id,'seed_ccfa' FROM questions q JOIN certification_tracks ct ON ct.code='CCFA'
   WHERE q.team_id=$1 AND q.objective='Preparação CCFA' ON CONFLICT DO NOTHING`,[team.id]);
 await client.query(`INSERT INTO import_runs(team_id,source,status,checkpoint,stats,finished_at) VALUES($1,$2,'checkpoint_saved',$3,$4,$5)`,[team.id,catalog.source,JSON.stringify(catalog.checkpoint),JSON.stringify({reportedTotal:catalog.reportedTotal,found:catalog.documents.length,fullText:0,cataloged,updated:0,duplicates:0,failures:0,questionsGenerated:0,questionsAwaitingReview:legacy.length}),catalog.capturedAt]);
 const certificationMappings=await mapDocumentsToCertifications(client,team.id);
 await client.query('COMMIT');console.log(JSON.stringify({team:team.id,courses:courses.length,labs:learning.labs.length,telemetry:learning.telemetry.length,queryExercises:learning.queryExercises.length,glossary:learning.glossary.length,cataloged,certificationMappings,questionsAwaitingReview:legacy.length},null,2));
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
