import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const materialRoot=path.resolve(projectRoot,'..','output','pdf','certificacoes_crowdstrike');
const bank=JSON.parse(await fs.readFile(path.join(materialRoot,'Banco_de_questoes_480.json'),'utf8'));
const codes=['CCFP','CCFA','CCFR','CCFH','CCSA','CCSE','CCIS','CCCS'];
const apply=process.argv.includes('--apply');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const normalized=value=>String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const checked=[];

for(const code of codes){
  const guideName=`${code}_Guia_de_estudo_e_simulado.md`;
  const bytes=await fs.readFile(path.join(materialRoot,guideName));
  const markdown=bytes.toString('utf8').replace(/\r\n/g,'\n');
  const questions=bank[code]?.questions;
  if(!Array.isArray(questions)||questions.length!==60)throw new Error(`${code}: esperadas 60 questões no JSON.`);
  const headings=[...markdown.matchAll(/^## Questão (\d{2}) - (.+)$/gm)];
  const answerStart=markdown.indexOf('# Respostas comentadas');
  if(headings.length!==120||answerStart<0)throw new Error(`${code}: guia sem 60 questões e 60 respostas comentadas.`);
  const prompts=headings.filter(x=>x.index<answerStart),answers=headings.filter(x=>x.index>answerStart);
  if(prompts.length!==60||answers.length!==60)throw new Error(`${code}: seções de questões ou respostas incompletas.`);
  const seen=new Set();
  for(let i=0;i<60;i++){
    const q=questions[i],number=i+1;
    if(q.n!==number||!q.stem||q.stem.length<25||!Array.isArray(q.choices)||q.choices.length!==4||
      q.choices.some(choice=>!choice||choice.length<3)||!['A','B','C','D'].includes(q.answer)||
      q.choices['ABCD'.indexOf(q.answer)]!==q.correct||!q.why||q.why.length<20||!q.ref){
      throw new Error(`${code} questão ${number}: JSON ou gabarito inválido.`);
    }
    const fingerprint=normalized(q.stem);
    if(seen.has(fingerprint))throw new Error(`${code}: enunciado duplicado na questão ${number}.`);
    seen.add(fingerprint);
    const promptBlock=markdown.slice(prompts[i].index,prompts[i+1]?.index??answerStart);
    const answerBlock=markdown.slice(answers[i].index,answers[i+1]?.index??markdown.length);
    if(Number(prompts[i][1])!==number||Number(answers[i][1])!==number||
      !promptBlock.includes(q.stem)||q.choices.some((choice,index)=>!promptBlock.includes(`- **${'ABCD'[index]})** ${choice}`))||
      answers[i][2]!==`Resposta ${q.answer}`||!answerBlock.includes(q.correct)||!answerBlock.includes(q.why)||!answerBlock.includes(q.ref)){
      throw new Error(`${code} questão ${number}: JSON diverge do guia Markdown.`);
    }
  }
  checked.push({code,guideName,bytes,markdown,questions,sha256:sha(bytes),topics:[...new Set(questions.map(q=>q.topic))]});
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',certifications:checked.map(x=>({code:x.code,questions:x.questions.length,topics:x.topics,sha256:x.sha256})),totalQuestions:checked.reduce((n,x)=>n+x.questions.length,0)},null,2));
if(!apply)process.exit(0);

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL||'postgresql://postgres@127.0.0.1:55432/postgres',max:1});
const client=await pool.connect();
let committed=false;
try{
  await client.query('BEGIN');
  const teams=(await client.query('SELECT id FROM teams ORDER BY created_at')).rows;
  if(teams.length!==1)throw new Error(`Importação local requer uma equipe; encontradas ${teams.length}.`);
  const teamId=teams[0].id;
  await client.query("SELECT set_config('app.team_id',$1,true)",[teamId]);
  const reviewer=(await client.query("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.team_id=$1 JOIN roles r ON r.id=m.role_id WHERE u.email='revisor.demo@example.invalid' AND r.code='admin_reviewer'",[teamId])).rows[0];
  if(!reviewer)throw new Error('Revisor Demo não encontrado. Nenhuma alteração efetuada.');
  const results=[];
  for(const source of checked){
    const cert=(await client.query('SELECT id FROM certification_tracks WHERE code=$1',[source.code])).rows[0];
    if(!cert)throw new Error(`${source.code}: certificação não cadastrada.`);
    const relativePath=`output/pdf/certificacoes_crowdstrike/${source.guideName}`;
    let document=(await client.query('SELECT id FROM documents WHERE team_id=$1 AND local_path=$2',[teamId,relativePath])).rows[0];
    if(!document)document=(await client.query(`INSERT INTO documents(
      team_id,title,category,product,language,source_kind,access_mode,source_type,local_path,
      is_public,requires_authentication,storage_permission,content_status,summary,ccfa_relevant,
      origin_confirmed,content_available,created_by,library_visibility
    ) VALUES($1,$2,'Guia de estudo independente',$3,'pt-BR','authorized_import','restricted',
      'downloaded_internal',$4,false,true,'internal_authorized','available',$5,$6,true,true,$7,'team_all') RETURNING id`,
    [teamId,`${source.code} — Guia de estudo e simulado independente`,source.code,relativePath,
      'Material fornecido pela usuária; questões e gabaritos não são oficiais da CrowdStrike.',source.code==='CCFA',reviewer.id])).rows[0];
    let version=(await client.query('SELECT id FROM document_versions WHERE document_id=$1 AND sha256=$2',[document.id,source.sha256])).rows[0];
    if(!version){
      const storageKey=`teams/${teamId}/documents/${source.code.toLowerCase()}-guide-${source.sha256.slice(0,16)}.md`;
      const destination=path.join(projectRoot,'storage','private',storageKey);
      await fs.mkdir(path.dirname(destination),{recursive:true});
      await fs.writeFile(destination,source.bytes,{mode:0o600});
      version=(await client.query(`INSERT INTO document_versions(document_id,version_label,sha256,mime_type,byte_size,storage_key,extraction_status,metadata,source_consulted_at)
        VALUES($1,'edição 2026-09-30',$2,'text/markdown',$3,$4,'completed',$5,now()) RETURNING id`,
      [document.id,source.sha256,source.bytes.length,storageKey,JSON.stringify({independentStudyMaterial:true,official:false,originalPath:relativePath})])).rows[0];
      await client.query('UPDATE documents SET current_version_id=$1,content_available=true WHERE id=$2',[version.id,document.id]);
      await client.query("INSERT INTO document_history(team_id,document_id,version_id,action,details) VALUES($1,$2,$3,'imported',$4)",
        [teamId,document.id,version.id,JSON.stringify({source:'user_provided',sha256:source.sha256})]);
    }
    await client.query(`INSERT INTO document_certifications(team_id,document_id,certification_id,relevance,rationale,mapping_source)
      VALUES($1,$2,$3,'supporting','Guia independente fornecido pela usuária.','user_provided')
      ON CONFLICT(team_id,document_id,certification_id) DO NOTHING`,[teamId,document.id,cert.id]);
    let inserted=0,existing=0;
    for(const q of source.questions){
      const chunk=`${q.stem}\n${q.choices.map((choice,index)=>`${'ABCD'[index]}. ${choice}`).join('\n')}\nResposta: ${q.answer}. ${q.correct}\n${q.why}\nReferência indicada pelo material: ${q.ref}`;
      await client.query(`INSERT INTO document_chunks(version_id,ordinal,section,content) VALUES($1,$2,$3,$4)
        ON CONFLICT(version_id,ordinal) DO NOTHING`,[version.id,q.n,`Simulado · questão ${q.n}`,chunk]);
      const code=`${source.code}-GUIDE-${source.sha256.slice(0,8)}-${String(q.n).padStart(3,'0')}`;
      const match=(await client.query('SELECT id FROM questions WHERE team_id=$1 AND question_code=$2',[teamId,code])).rows[0];
      if(match){existing++;continue;}
      const correctIndex='ABCD'.indexOf(q.answer);
      const question=(await client.query(`INSERT INTO questions(
        team_id,author_id,question_code,category,subcategory,difficulty,format,objective,competency,
        prompt,options,correct_answer,correct_count,explanation,status,generated_by_ai,
        revalidate,approved_by,approved_at,reviewer_id,reviewed_at,official_domain,
        official_subobjective,tags,content_fingerprint,normalized_text_hash
      ) VALUES($1,$2,$3,$4,$5,'intermediária','administrative_scenario',$6,
        'Estudo por cenário',$7,$8,$9,1,$10,'published',false,false,$2,now(),$2,now(),
        $4,$5,$11,$12,$13) RETURNING id`,
      [teamId,reviewer.id,code,q.topic,q.ref,`Preparação ${source.code}`,q.stem,
        JSON.stringify(q.choices),JSON.stringify(correctIndex),q.why,
        JSON.stringify([source.code,'material independente','simulado']),sha(`${source.code}\n${q.stem}\n${q.choices.join('\n')}`),sha(normalized(q.stem))])).rows[0];
      await client.query(`INSERT INTO question_sources(question_id,version_id,source_url,section,excerpt,source_type,source_title,source_version,relative_path,consulted_at,validation_status)
        VALUES($1,$2,$3,$4,$5,'downloaded_internal',$6,$7,$8,now(),'validated_content')`,
      [question.id,version.id,`urn:falcon-certification-lab:${source.code.toLowerCase()}-guide:${source.sha256}`,
        `Simulado · questão ${q.n}`,chunk,`${source.code} — Guia de estudo e simulado independente`,
        `sha256:${source.sha256.slice(0,16)}`,relativePath]);
      await client.query(`INSERT INTO question_certifications(team_id,question_id,certification_id,mapping_source)
        VALUES($1,$2,$3,'user_provided_guide')`,[teamId,question.id,cert.id]);
      for(let i=0;i<4;i++)await client.query(`INSERT INTO question_options(question_id,language,option_index,option_text,is_correct,explanation)
        VALUES($1,'pt-BR',$2,$3,$4,$5)`,[question.id,i,q.choices[i],i===correctIndex,i===correctIndex?q.why:'']);
      await client.query(`INSERT INTO question_versions(question_id,version,snapshot,change_reason,created_by)
        VALUES($1,1,$2,'Importação de guia fornecido pela usuária',$3)`,
      [question.id,JSON.stringify({prompt:q.stem,options:q.choices,correctAnswer:correctIndex,explanation:q.why,category:q.topic,sourceSection:`Simulado · questão ${q.n}`}),reviewer.id]);
      await client.query(`INSERT INTO reviews(team_id,question_id,reviewer_id,decision,comment)
        VALUES($1,$2,$3,'published','Gabarito conferido com o guia fornecido pela usuária; fonte independente, não oficial.')`,
      [teamId,question.id,reviewer.id]);
      inserted++;
    }
    results.push({code:source.code,inserted,existing,documentId:document.id});
  }
  // O pacote CCFA reordena as alternativas das mesmas 60 questões já publicadas
  // pelo PDF anterior. Guardamos a versão importada, mas não repetimos enunciados.
  const duplicates=(await client.query(`UPDATE questions imported SET status='archived',updated_at=now()
    WHERE imported.team_id=$1 AND imported.question_code LIKE 'CCFA-GUIDE-%' AND imported.status='published'
      AND EXISTS(SELECT 1 FROM questions previous WHERE previous.team_id=imported.team_id
        AND previous.question_code LIKE 'CCFA-PDF-%' AND previous.status='published'
        AND previous.normalized_text_hash=imported.normalized_text_hash)
    RETURNING imported.id`,[teamId])).rows.length;
  await client.query('COMMIT');committed=true;
  console.log(JSON.stringify({imported:results.reduce((n,x)=>n+x.inserted,0),ccfaDuplicateVariantsArchived:duplicates,results},null,2));
}catch(error){if(!committed)await client.query('ROLLBACK').catch(()=>{});throw error;}
finally{client.release();await pool.end();}
