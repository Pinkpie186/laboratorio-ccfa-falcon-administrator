import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageRoot=path.resolve(projectRoot,'..','output','pdf','crowdstrike_certifications_en');
const portugueseRoot=path.resolve(projectRoot,'..','output','pdf','certificacoes_crowdstrike');
const codes=['CCFP','CCFA','CCFR','CCFH','CCSA','CCSE','CCIS','CCCS'];
const apply=process.argv.includes('--apply');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const bank=JSON.parse(await fs.readFile(path.join(packageRoot,'Question_Bank_480_EN.json'),'utf8'));
const labMap=JSON.parse(await fs.readFile(path.join(packageRoot,'Lab_to_Question_Map.json'),'utf8'));
const references=JSON.parse(await fs.readFile(path.join(packageRoot,'Certifications_and_References_EN.json'),'utf8'));

const checked=[];
for(const code of codes){
  const questions=bank[code]?.questions;
  if(!Array.isArray(questions)||questions.length!==60)throw new Error(`${code}: expected 60 English questions.`);
  const distribution={A:0,B:0,C:0,D:0};
  const seen=new Set();
  for(const [index,q] of questions.entries()){
    if(q.n!==index+1||!q.stem||!Array.isArray(q.choices)||q.choices.length!==4||
      !['A','B','C','D'].includes(q.answer)||q.choices['ABCD'.indexOf(q.answer)]!==q.correct||!q.why||!q.ref){
      throw new Error(`${code} Q${index+1}: invalid question, options, answer, explanation or reference.`);
    }
    const key=q.stem.trim().toLowerCase();
    if(seen.has(key))throw new Error(`${code} Q${q.n}: duplicate stem.`);
    seen.add(key);distribution[q.answer]++;
  }
  if(Object.values(distribution).some(total=>total!==15))throw new Error(`${code}: answer-letter distribution is not 15/15/15/15.`);
  const guideMd=`${code}_Study_Guide_and_Practice_Exam_EN.md`;
  const guidePdf=`${code}_Study_Guide_and_Practice_Exam_EN.pdf`;
  const [markdown,pdfBytes]=await Promise.all([
    fs.readFile(path.join(packageRoot,guideMd),'utf8'),
    fs.readFile(path.join(packageRoot,guidePdf))
  ]);
  if(!markdown.includes('60 scenario questions')||!markdown.includes('## Official domains'))throw new Error(`${guideMd}: expected study-guide markers not found.`);
  checked.push({code,questions,distribution,guideMd,guidePdf,markdown,pdfBytes});
}
if(!Array.isArray(labMap)||labMap.length!==32)throw new Error('Expected 32 mapped labs.');
for(const code of codes){
  const labs=labMap.filter(lab=>lab.code===code);
  if(labs.length!==4)throw new Error(`${code}: expected four labs.`);
  for(const lab of labs)if(!lab.id||!lab.title||!lab.objective||!Array.isArray(lab.steps)||lab.steps.length<3||
    !Array.isArray(lab.questions)||!lab.questions.length||!lab.expected||!lab.evidence||!lab.minutes){
    throw new Error(`${lab.id||code}: incomplete lab mapping.`);
  }
}
if(references.certifications?.length!==8)throw new Error('Expected metadata for eight certifications.');

console.log(JSON.stringify({mode:apply?'apply':'dry-run',questions:480,labs:32,certifications:checked.map(x=>({code:x.code,questions:x.questions.length,labs:labMap.filter(l=>l.code===x.code).length,answers:x.distribution}))},null,2));
if(!apply)process.exit(0);

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL||'postgresql://postgres@127.0.0.1:55432/postgres',max:1});
const client=await pool.connect();
let committed=false;
const safeRelative=name=>`output/pdf/crowdstrike_certifications_en/${name}`;

async function upsertDocument({teamId,reviewerId,certId,code,name,bytes,mime,category,title,summary}){
  const relativePath=safeRelative(name),digest=sha(bytes);
  let document=(await client.query('SELECT id FROM documents WHERE team_id=$1 AND local_path=$2',[teamId,relativePath])).rows[0];
  if(!document)document=(await client.query(`INSERT INTO documents(
    team_id,title,category,product,language,source_kind,access_mode,source_type,local_path,
    is_public,requires_authentication,storage_permission,content_status,summary,ccfa_relevant,
    origin_confirmed,content_available,created_by,library_visibility,review_status,updated_date,synchronized_at,last_checked_at
  ) VALUES($1,$2,$3,$4,'en-US','authorized_import','restricted','downloaded_internal',$5,
    false,true,'internal_authorized','available',$6,$7,true,true,$8,'team_all','current','2026-10-05',now(),now()) RETURNING id`,
  [teamId,title,category,code,relativePath,summary,code==='CCFA',reviewerId])).rows[0];
  let version=(await client.query('SELECT id FROM document_versions WHERE document_id=$1 AND sha256=$2',[document.id,digest])).rows[0];
  if(!version){
    const extension=path.extname(name).toLowerCase();
    const storageKey=`teams/${teamId}/documents/english-${code.toLowerCase()}-${digest.slice(0,16)}${extension}`;
    const destination=path.join(projectRoot,'storage','private',storageKey);
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,bytes,{mode:0o600});
    version=(await client.query(`INSERT INTO document_versions(document_id,version_label,sha256,mime_type,byte_size,storage_key,extraction_status,metadata,source_consulted_at)
      VALUES($1,'English edition 2026-10-05',$2,$3,$4,$5,$6,$7,'2026-10-05') RETURNING id`,
    [document.id,digest,mime,bytes.length,storageKey,mime==='text/markdown'?'complete':'stored',JSON.stringify({independentStudyMaterial:true,official:false,language:'en-US',relativePath})])).rows[0];
    await client.query('UPDATE documents SET current_version_id=$1,content_available=true,synchronized_at=now(),last_checked_at=now() WHERE id=$2',[version.id,document.id]);
    await client.query("INSERT INTO document_history(team_id,document_id,version_id,action,details) VALUES($1,$2,$3,'imported',$4)",
      [teamId,document.id,version.id,JSON.stringify({source:'user_provided_english_package',sha256:digest})]);
    if(mime==='text/markdown'){
      const text=bytes.toString('utf8').replace(/\r\n/g,'\n');
      const sections=text.split(/(?=^##?\s)/m).filter(Boolean);
      for(const [ordinal,content] of sections.entries()){
        const heading=content.match(/^#{1,2}\s+(.+)$/m)?.[1]?.slice(0,240)||`Section ${ordinal+1}`;
        await client.query('INSERT INTO document_chunks(version_id,ordinal,section,content) VALUES($1,$2,$3,$4) ON CONFLICT(version_id,ordinal) DO NOTHING',[version.id,ordinal,heading,content]);
      }
    }
  }
  await client.query(`INSERT INTO document_certifications(team_id,document_id,certification_id,relevance,rationale,mapping_source)
    VALUES($1,$2,$3,'essential','English study or lab material supplied by the user.','user_provided_english_package')
    ON CONFLICT(team_id,document_id,certification_id) DO UPDATE SET relevance='essential',rationale=EXCLUDED.rationale,mapping_source=EXCLUDED.mapping_source,updated_at=now()`,
  [teamId,document.id,certId]);
  return{documentId:document.id,versionId:version.id};
}

async function resolveQuestion(teamId,certId,code,number,ptPrefix){
  const guideCode=`${code}-GUIDE-${ptPrefix}-${String(number).padStart(3,'0')}`;
  let row=(await client.query('SELECT id,normalized_text_hash,status FROM questions WHERE team_id=$1 AND question_code=$2',[teamId,guideCode])).rows[0];
  if(!row)row=(await client.query(`SELECT q.id,q.normalized_text_hash,q.status FROM questions q
    JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id
    WHERE q.team_id=$1 AND qc.certification_id=$2 AND q.question_code LIKE $3
    ORDER BY (q.status='published') DESC,q.updated_at DESC LIMIT 1`,[teamId,certId,`${code}-GUIDE-%-${String(number).padStart(3,'0')}`])).rows[0];
  if(row?.status==='archived'&&row.normalized_text_hash){
    const published=(await client.query(`SELECT q.id FROM questions q JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id
      WHERE q.team_id=$1 AND qc.certification_id=$2 AND q.normalized_text_hash=$3 AND q.status='published' ORDER BY q.updated_at DESC LIMIT 1`,
    [teamId,certId,row.normalized_text_hash])).rows[0];
    if(published)row={...row,id:published.id,status:'published'};
  }
  return row;
}

try{
  await client.query('BEGIN');
  const teams=(await client.query('SELECT id FROM teams ORDER BY created_at')).rows;
  if(teams.length!==1)throw new Error(`Local import requires exactly one team; found ${teams.length}.`);
  const teamId=teams[0].id;
  await client.query("SELECT set_config('app.team_id',$1,true)",[teamId]);
  const reviewer=(await client.query("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.team_id=$1 JOIN roles r ON r.id=m.role_id WHERE r.code='admin_reviewer' ORDER BY u.created_at LIMIT 1",[teamId])).rows[0];
  if(!reviewer)throw new Error('No admin_reviewer account found.');
  let translations=0,documents=0,missingQuestions=0;
  const questionIds=new Map();
  for(const source of checked){
    const cert=(await client.query('SELECT id FROM certification_tracks WHERE code=$1',[source.code])).rows[0];
    if(!cert)throw new Error(`${source.code}: certification is not registered.`);
    const ptName=`${source.code}_Guia_de_estudo_e_simulado.md`;
    const ptPrefix=sha(await fs.readFile(path.join(portugueseRoot,ptName))).slice(0,8);
    for(const q of source.questions){
      const target=await resolveQuestion(teamId,cert.id,source.code,q.n,ptPrefix);
      if(!target){missingQuestions++;continue;}
      const correctIndex='ABCD'.indexOf(q.answer);
      await client.query(`INSERT INTO question_translations(question_id,language,prompt,options,explanation,distractor_explanations,translation_status,translation_method,reviewed_by,reviewed_at)
        VALUES($1,'en-US',$2,$3,$4,'[]','reviewed','user_provided_english_edition',$5,now())
        ON CONFLICT(question_id,language) DO UPDATE SET prompt=EXCLUDED.prompt,options=EXCLUDED.options,explanation=EXCLUDED.explanation,
          translation_status='reviewed',translation_method=EXCLUDED.translation_method,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now(),updated_at=now()`,
      [target.id,q.stem,JSON.stringify(q.choices),q.why,reviewer.id]);
      for(let index=0;index<4;index++)await client.query(`INSERT INTO question_options(question_id,language,option_index,option_text,is_correct,explanation)
        VALUES($1,'en-US',$2,$3,$4,$5) ON CONFLICT(question_id,language,option_index) DO UPDATE SET option_text=EXCLUDED.option_text,is_correct=EXCLUDED.is_correct,explanation=EXCLUDED.explanation,updated_at=now()`,
      [target.id,index,q.choices[index],index===correctIndex,index===correctIndex?q.why:'']);
      questionIds.set(`${source.code}:${q.n}`,target.id);translations++;
    }
    const summary=`Independent English ${source.code} study guide supplied by the user. It contains 60 original scenario questions and is not an official CrowdStrike exam.`;
    await upsertDocument({teamId,reviewerId:reviewer.id,certId:cert.id,code:source.code,name:source.guideMd,bytes:Buffer.from(source.markdown),mime:'text/markdown',category:'Study Guides — English',title:`${source.code} — Study Guide and Practice Exam (English · Markdown)`,summary});documents++;
    await upsertDocument({teamId,reviewerId:reviewer.id,certId:cert.id,code:source.code,name:source.guidePdf,bytes:source.pdfBytes,mime:'application/pdf',category:'Study Guides — English',title:`${source.code} — Study Guide and Practice Exam (English · PDF)`,summary});documents++;
  }
  const workbookMdName='CrowdStrike_Labs_Workbook_EN.md',workbookPdfName='CrowdStrike_Labs_Workbook_EN.pdf';
  const [workbookMd,workbookPdf]=await Promise.all([fs.readFile(path.join(packageRoot,workbookMdName)),fs.readFile(path.join(packageRoot,workbookPdfName))]);
  for(const code of codes){
    const cert=(await client.query('SELECT id FROM certification_tracks WHERE code=$1',[code])).rows[0];
    const summary='English workbook with four safe, primarily offline labs for this certification, using synthetic fixtures and optional authorized console extensions.';
    await upsertDocument({teamId,reviewerId:reviewer.id,certId:cert.id,code,name:workbookMdName,bytes:workbookMd,mime:'text/markdown',category:'Labs — English',title:'CrowdStrike Labs Workbook (English · Markdown)',summary});
    await upsertDocument({teamId,reviewerId:reviewer.id,certId:cert.id,code,name:workbookPdfName,bytes:workbookPdf,mime:'application/pdf',category:'Labs — English',title:'CrowdStrike Labs Workbook (English · PDF)',summary});
  }
  documents+=2;
  let labs=0,mappings=0;
  for(const item of labMap){
    const cert=(await client.query('SELECT id FROM certification_tracks WHERE code=$1',[item.code])).rows[0];
    const rubric=['Scope defined','Method reproducible','Evidence retained','Interpretation supported','Cleanup or limitations recorded'];
    const values=[item.id,item.title,'Certification workbook',item.code,'guided practical',item.objective,
      JSON.stringify(['Use only the supplied synthetic fixtures.','Keep the work offline unless the optional console extension is explicitly authorized.','Do not include credentials, tenant identifiers, hostnames or IP addresses in evidence.']),
      'Offline by default. Optional Falcon console work requires an authorized test tenant and least privilege.',
      'Local analysis of synthetic JSON/CSV fixtures; never use the primary workstation for impact testing.',JSON.stringify(item.steps),
      item.expected,'Low risk in offline mode. Fixture schemas are educational and are not native Falcon exports.',
      'Stop before any optional console step if authorization, test scope, data handling or rollback is unclear.',
      'Remove only local notes/derived files created for the exercise; retain approved sanitized evidence.',
      'No live change is required. If an optional console extension is used, follow the approved tenant rollback.',
      [item.code,'english','offline','synthetic-fixtures','certification-workbook'],cert.id,'en-US','crowdstrike_certifications_en_2026-10-05',
      safeRelative('CrowdStrike_Labs_Workbook_EN.md'),item.minutes,JSON.stringify(item.files||[]),JSON.stringify(item.questions),
      JSON.stringify(item.references||[]),item.evidence,item.extension||'',JSON.stringify(rubric)];
    const lab=(await client.query(`INSERT INTO labs(code,title,category,domain,difficulty,safe,objective,prerequisites,authorization_note,isolated_environment,
      steps,validation_queries,expected_result,risks,stop_criteria,cleanup,rollback,tags,certification_id,content_language,source_package,
      source_document_path,estimated_minutes,fixture_files,question_numbers,reference_topics,evidence_requirements,console_extension,rubric)
      VALUES($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,'[]',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,category=EXCLUDED.category,domain=EXCLUDED.domain,difficulty=EXCLUDED.difficulty,
        safe=true,objective=EXCLUDED.objective,prerequisites=EXCLUDED.prerequisites,authorization_note=EXCLUDED.authorization_note,
        isolated_environment=EXCLUDED.isolated_environment,steps=EXCLUDED.steps,expected_result=EXCLUDED.expected_result,risks=EXCLUDED.risks,
        stop_criteria=EXCLUDED.stop_criteria,cleanup=EXCLUDED.cleanup,rollback=EXCLUDED.rollback,tags=EXCLUDED.tags,
        certification_id=EXCLUDED.certification_id,content_language=EXCLUDED.content_language,source_package=EXCLUDED.source_package,
        source_document_path=EXCLUDED.source_document_path,estimated_minutes=EXCLUDED.estimated_minutes,fixture_files=EXCLUDED.fixture_files,
        question_numbers=EXCLUDED.question_numbers,reference_topics=EXCLUDED.reference_topics,evidence_requirements=EXCLUDED.evidence_requirements,
        console_extension=EXCLUDED.console_extension,rubric=EXCLUDED.rubric RETURNING id`,values)).rows[0];
    await client.query('DELETE FROM lab_question_mappings WHERE lab_id=$1',[lab.id]);
    for(const number of item.questions){
      const questionId=questionIds.get(`${item.code}:${number}`)||null;
      await client.query(`INSERT INTO lab_question_mappings(lab_id,certification_id,question_number,question_id,mapping_source)
        VALUES($1,$2,$3,$4,'user_provided_lab_map')`,[lab.id,cert.id,number,questionId]);mappings++;
    }
    labs++;
  }
  await client.query('COMMIT');committed=true;
  console.log(JSON.stringify({imported:{translations,documents,labs,mappings},missingQuestions,preservedLegacyLabs:true},null,2));
}catch(error){if(!committed)await client.query('ROLLBACK').catch(()=>{});throw error;}
finally{client.release();await pool.end();}
