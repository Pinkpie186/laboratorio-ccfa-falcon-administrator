import crypto from 'node:crypto';
import { z } from 'zod';
import { query,transaction } from './db.js';
import { randomToken,seededShuffle,sha256 } from './security.js';
import { buildFlexiblePlan,toStableIcs } from './flexible-planner.js';
import { buildSimulationReport,simulationWeek } from './simulation-report.js';

const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const parse=(schema,value)=>{const out=schema.safeParse(value);if(!out.success){const error=new Error(out.error.issues.map(x=>x.message).join('; '));error.status=400;throw error;}return out.data;};
const scope=req=>({teamId:req.auth.team_id,userId:req.auth.user_id});
const audit=(c,req,action,type,id,data={})=>c.query('INSERT INTO audit_log(team_id,actor_id,action,entity_type,entity_id,data) VALUES($1,$2,$3,$4,$5,$6)',[req.auth.team_id,req.auth.user_id,action,type,id?String(id):null,JSON.stringify(data)]);
const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
const dateOnly=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
function practiceDate(goal){
  if(goal.planned_simulation_date)return dateOnly(goal.planned_simulation_date);
  const target=new Date(`${dateOnly(goal.target_date)}T12:00:00Z`);
  target.setUTCDate(target.getUTCDate()-Math.max(1,Number(goal.final_review_days||7)));
  const suggested=target.toISOString().slice(0,10),today=new Date().toISOString().slice(0,10);
  return suggested>today?suggested:null;
}
function goalMilestones(goal,certification){
  const target=dateOnly(goal.target_date),sim=practiceDate(goal),rows=[];
  if(sim)rows.push({id:`sim-plan-${goal.id}`,kind:'simulation_plan',status:'planned',activity_type:'simulation',title:`Simulado ${goal.planned_simulation_date?'planejado':'sugerido'} · ${certification.code}`,planned_start:`${sim}T19:00:00-03:00`,planned_end:`${sim}T20:30:00-03:00`,planned_minutes:90,priority:5,locked:true,sync_identifier:`falcon-simulation-${goal.id}`,activities:[]});
  rows.push({id:`goal-target-${goal.id}`,kind:'goal_target',status:'planned',activity_type:'milestone',title:`Data final da meta · ${certification.code}`,planned_start:`${target}T12:00:00-03:00`,planned_end:`${target}T12:15:00-03:00`,planned_minutes:0,priority:5,locked:true,sync_identifier:`falcon-target-${goal.id}`,activities:[]});
  return rows;
}
const questionLanguage=z.enum(['pt-BR','en-US']);
export const simulationModePresets=Object.freeze({
  quick:{count:10,durationMinutes:20},
  domain:{count:10,durationMinutes:20},
  custom:{count:20,durationMinutes:30},
  adaptive:{count:20,durationMinutes:30},
  error_review:{count:10,durationMinutes:20},
  full:{count:60,durationMinutes:90}
});
const sameAnswer=(expected,received)=>{
  const normalize=value=>Array.isArray(value)?[...value].map(Number).sort((a,b)=>a-b):Number(value);
  return JSON.stringify(normalize(expected))===JSON.stringify(normalize(received));
};
export function selectSimulationDomain(candidates,requestedDomain,count){
  const domain=clean(requestedDomain);
  if(!domain)throw Object.assign(new Error('Escolha um domínio para este modo.'),{status:400});
  const selected=candidates.filter(question=>question.category===domain);
  if(selected.length<count)throw Object.assign(new Error(`O domínio “${domain}” possui ${selected.length} questões disponíveis; são necessárias ${count}.`),{status:409,available:selected.length});
  return{domain,candidates:selected};
}

const categoryCourse=category=>{
  const value=String(category).toLowerCase();
  if(/sensor|endpoint/.test(value))return'FALCON 105';
  if(/dashboard|report/.test(value))return'FALCON 106';
  if(/firewall/.test(value))return'FALCON 107';
  if(/fusion|soar/.test(value))return'SOAR 100';
  if(/vulnerab|exposure/.test(value))return'ITSEC 121';
  if(/asset|invent/.test(value))return'ITSEC 122';
  if(/mobile/.test(value))return'FALCON 160';
  if(/onboard|management|api|audit/.test(value))return'FALCON 102';
  return'FALCON 101';
};

async function evidenceActivities(c,req,certification){
  const chunks=(await c.query(`WITH ranked AS (
    SELECT d.id document_id,d.title document_title,d.category,d.current_version_id version_id,v.version_label,v.sha256,
      dc.page_number,dc.section,dc.ordinal,dc.content,row_number() OVER(PARTITION BY d.category ORDER BY d.title,dc.page_number NULLS LAST,dc.ordinal) rn
    FROM documents d JOIN document_certifications mapping ON mapping.document_id=d.id AND mapping.team_id=d.team_id AND mapping.certification_id=$2
      JOIN document_versions v ON v.id=d.current_version_id JOIN document_chunks dc ON dc.version_id=v.id
    WHERE d.team_id=$1 AND d.content_available AND d.source_type<>'portal_link' AND d.title NOT ILIKE '%dump%'
      AND length(dc.content)>=180 AND (dc.page_number IS NOT NULL OR dc.section IS NOT NULL)
  ) SELECT * FROM ranked WHERE rn<=3 ORDER BY category,document_title,page_number NULLS LAST,ordinal LIMIT 54`,[req.auth.team_id,certification.id])).rows;
  const courses=(await c.query('SELECT id,code,title,position,duration_minutes,official_url FROM courses ORDER BY position')).rows;
  const courseByCode=new Map(courses.map(x=>[x.code,x]));
  const counts=(await c.query("SELECT q.category,count(*) n FROM questions q JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id WHERE q.team_id=$1 AND qc.certification_id=$2 AND q.status IN ('review','approved','published') AND EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id) GROUP BY q.category",[req.auth.team_id,certification.id])).rows;
  const exercises=certification.code==='CCFA'?(await c.query("SELECT id,code,left(prompt,120) title,position FROM query_exercises ORDER BY position LIMIT 4")).rows:[];
  const labs=certification.code==='CCFA'?(await c.query('SELECT id,code,title,objective,category FROM labs ORDER BY code LIMIT 8')).rows:[];
  const activities=[];
  if(certification.code==='CCFA'){
    const submodules=(await c.query(`SELECT s.id,s.course_id,s.title,s.position,s.duration_minutes,c.duration_minutes course_minutes,
      COALESCE(p.status,'not_started') progress_status
      FROM submodules s JOIN courses c ON c.id=s.course_id
      LEFT JOIN progress p ON p.user_id=$1 AND p.entity_type='submodule' AND p.entity_id=s.id
      WHERE s.team_id=$2 ORDER BY c.position,s.position`,[req.auth.user_id,req.auth.team_id])).rows;
    const byCourse=new Map();for(const sub of submodules)byCourse.set(sub.course_id,[...(byCourse.get(sub.course_id)||[]),sub]);
    const courseProgress=(await c.query("SELECT entity_id,status FROM progress WHERE user_id=$1 AND entity_type='course'",[req.auth.user_id])).rows;
    const completedCourses=new Set(courseProgress.filter(x=>x.status==='completed').map(x=>String(x.entity_id)));
    for(const course of courses){
      if(completedCourses.has(String(course.id)))continue;
      const confirmed=byCourse.get(course.id)||[];
      if(confirmed.length){
        for(const sub of confirmed){if(sub.progress_status==='completed')continue;
          activities.push({id:`submodule-${sub.id}`,activityType:'module',title:`${course.code} · ${sub.title}`,objective:'Estudar o submódulo confirmado no material autorizado.',topic:course.title,instructions:'Acesse o curso e registre notas sem copiar conteúdo fechado.',keyConcepts:[course.code,sub.title],completionCriteria:'Registrar tempo, progresso e conclusão do submódulo.',deliverable:'Nota de estudo e progresso.',estimatedMinutes:Math.max(20,Number(sub.duration_minutes||Math.ceil(course.duration_minutes/confirmed.length)||30)),priority:5,prerequisiteOrder:course.position*10,courseId:course.id,submoduleId:sub.id,curatorStatus:'ready',sourceFingerprint:sha256(`submodule:${sub.id}`)});
        }
      }else if(Number(course.duration_minutes)>0){
        activities.push({id:`course-${course.id}`,activityType:'module',title:`Curso ${course.code} · ${course.title}`,objective:'Estudar o curso oficial, sem presumir aulas internas não confirmadas.',topic:course.title,instructions:'Acesse o curso oficial e registre manualmente as unidades e notas autorizadas.',keyConcepts:[course.code],completionCriteria:'Registrar estudo e conclusão do curso.',deliverable:'Progresso do curso.',estimatedMinutes:Number(course.duration_minutes),priority:5,prerequisiteOrder:course.position*10,courseId:course.id,curatorStatus:'ready',sourceFingerprint:sha256(`course:${course.id}`)});
      }
    }
  }else{
    const domains=(await c.query('SELECT id,title,position FROM certification_domains WHERE certification_id=$1 ORDER BY position',[certification.id])).rows;
    for(const domain of domains)activities.push({id:`domain-${domain.id}`,activityType:'module',title:`Domínio ${domain.position} · ${domain.title}`,objective:'Estudar o objetivo publicado no Exam Guide oficial.',topic:domain.title,instructions:'Consulte o Exam Guide e os materiais relacionados; registre os tópicos estudados.',keyConcepts:[domain.title],completionCriteria:'Registrar estudo e anotações do domínio.',deliverable:'Notas de estudo.',estimatedMinutes:40,priority:5,prerequisiteOrder:domain.position*10,curatorStatus:'ready',sourceFingerprint:sha256(`domain:${domain.id}`)});
  }
  for(const [index,x] of chunks.entries()){
    const course=certification.code==='CCFA'?courseByCode.get(categoryCourse(x.category))||courses[0]:null;
    const page=x.page_number?`página ${x.page_number}`:`seção ${x.section}`;
    const excerpt=clean(x.content).slice(0,900);
    activities.push({id:`read-${x.version_id}-${x.ordinal}`,activityType:'document',title:`Leitura: ${x.document_title} — ${page}`,objective:`Compreender o conteúdo verificável de ${x.document_title}.`,topic:x.section||x.category,instructions:`Leia ${page} e confronte os conceitos diretamente com o trecho citado.`,keyConcepts:[x.category,x.section].filter(Boolean),completionCriteria:'Registrar a leitura e explicar o trecho sem consultar dados do tenant.',deliverable:'Nota de estudo sanitizada.',estimatedMinutes:index%3===0?25:20,priority:3,prerequisiteOrder:Number(course?.position||1)*10,courseId:course?.id,documentId:x.document_id,versionId:x.version_id,pageNumber:x.page_number,section:x.section,excerpt,questionCategory:x.category,curatorStatus:'ready',sourceFingerprint:sha256(`read:${x.version_id}:${x.ordinal}`)});
  }
  for(const [index,x] of counts.entries()){
    const course=certification.code==='CCFA'?courseByCode.get(categoryCourse(x.category))||courses[0]:null;
    activities.push({id:`quiz-${x.category}`,activityType:'quiz',title:`Quiz: ${x.category} — ${Math.min(10,Number(x.n))} questões citadas`,objective:`Verificar retenção no domínio ${x.category}.`,topic:x.category,instructions:'Responder às questões disponíveis e registrar os erros para revisão espaçada.',keyConcepts:[x.category],completionCriteria:'Concluir o conjunto e revisar cada resposta incorreta.',deliverable:'Resultado do quiz e lista de erros.',estimatedMinutes:25,priority:4,prerequisiteOrder:Number(course?.position||1)*10+8,courseId:course?.id,questionCategory:x.category,questionCount:Math.min(10,Number(x.n)),curatorStatus:'ready',sourceFingerprint:sha256(`quiz:${x.category}`)});
  }
  for(const x of exercises)activities.push({id:`query-${x.id}`,activityType:'query',title:`Query: ${x.code} — ${x.title}`,objective:'Praticar a linguagem documentada sem inventar campos do tenant.',topic:x.title,instructions:'Leia a lição oficial, aplique somente operadores documentados e use placeholders até confirmar o esquema.',keyConcepts:['CQL','LogScale','Event Search'],completionCriteria:'Concluir o exercício e justificar cada operador.',deliverable:'Query sanitizada ou indicação de conteúdo pendente.',estimatedMinutes:20,priority:3,prerequisiteOrder:130+Number(x.position),queryExerciseId:x.id,curatorStatus:'ready',sourceFingerprint:sha256(`query:${x.id}`)});
  for(const [index,x] of labs.entries())activities.push({id:`lab-${x.id}`,activityType:'lab',title:`Lab seguro: ${x.code} — ${x.title}`,objective:x.objective,topic:x.category,instructions:'Executar somente em tenant/VM autorizados, começando por dry-run quando houver script.',keyConcepts:[x.category,'evidência','rollback'],completionCriteria:'Registrar resultado, evidência sanitizada e limpeza/rollback.',deliverable:'Evidência sanitizada e confirmação de limpeza.',estimatedMinutes:35,priority:4,prerequisiteOrder:160+index,labId:x.id,curatorStatus:'ready',sourceFingerprint:sha256(`lab:${x.id}`)});
  return activities;
}

function balancedSelection(rows,count,seed){
  const shuffled=seededShuffle(rows,seed),groups=new Map();
  for(const row of shuffled){const key=`${row.category}|${row.difficulty}`;const list=groups.get(key)||[];list.push(row);groups.set(key,list);}
  const selected=[];const lists=[...groups.values()];
  while(selected.length<count&&lists.some(x=>x.length))for(const list of lists){if(list.length&&selected.length<count)selected.push(list.shift());}
  return selected;
}

async function ensurePointRules(c,teamId){
  const rules=[['question_correct','Questão correta',5,100],['simulation_finished','Simulado concluído',40,80],['activity_completed','Atividade concluída',10,120],['lab_completed','Lab com evidência',50,100],['review_completed','Revisão espaçada',15,90]];
  for(const rule of rules)await c.query('INSERT INTO point_rules(team_id,code,label,points,daily_cap) VALUES($1,$2,$3,$4,$5) ON CONFLICT(team_id,code) DO NOTHING',[teamId,...rule]);
}

async function activeCertification(c,userId){
  return (await c.query(`SELECT ct.id,ct.code,ct.title FROM certification_enrollments ce
    JOIN certification_tracks ct ON ct.id=ce.certification_id
    WHERE ce.user_id=$1 AND ce.is_active LIMIT 1`,[userId])).rows[0]||null;
}

async function ensureSimulationReport(c,req,simulation){
  const stored=(await c.query('SELECT report FROM simulation_reports WHERE simulation_id=$1 AND user_id=$2',[simulation.id,req.auth.user_id])).rows[0];
  if(stored)return stored.report;
  const questions=(await c.query(`SELECT sq.position,q.id,q.category,q.difficulty,
    COALESCE(qt.prompt,q.prompt) prompt,COALESCE(qt.options,q.options) options,
    q.correct_answer,COALESCE(qt.explanation,q.explanation) explanation,
    a.answer,a.correct,a.elapsed_seconds,
    qs.source_title,qs.source_version,qs.section,qs.page_number,qs.source_url
    FROM simulation_questions sq JOIN questions q ON q.id=sq.question_id
    LEFT JOIN question_translations qt ON qt.question_id=q.id AND qt.language=$2 AND qt.translation_status='reviewed'
    LEFT JOIN answers a ON a.simulation_id=sq.simulation_id AND a.question_id=q.id
    LEFT JOIN LATERAL (SELECT source_title,source_version,section,page_number,source_url
      FROM question_sources WHERE question_id=q.id AND validation_status='validated_content'
      ORDER BY consulted_at DESC NULLS LAST LIMIT 1) qs ON true
    WHERE sq.simulation_id=$1 ORDER BY sq.position`,[simulation.id,simulation.language||'pt-BR'])).rows.map(row=>({
      ...row,source:row.source_title?{
        title:row.source_title,version:row.source_version,section:row.section,page:row.page_number,
        url:/^https:\/\/(?:[a-z0-9-]+\.)*(?:crowdstrike\.com|humio\.com)(?:\/|$)/i.test(row.source_url||'')?row.source_url:null
      }:null
    }));
  const certification=simulation.certification_id?(await c.query('SELECT code,title FROM certification_tracks WHERE id=$1',[simulation.certification_id])).rows[0]:null;
  const report=buildSimulationReport(simulation,questions,certification);
  await c.query(`INSERT INTO simulation_reports(simulation_id,team_id,user_id,report)
    VALUES($1,$2,$3,$4) ON CONFLICT(simulation_id) DO NOTHING`,
    [simulation.id,req.auth.team_id,req.auth.user_id,JSON.stringify(report)]);
  return report;
}

export function registerPlatformRoutes(app,{requireAuth,requireCsrf,allow}){
  app.put('/api/v2/preferences/question-language',requireAuth,requireCsrf,route(async(req,res)=>{
    const language=parse(z.object({language:questionLanguage}),req.body).language;
    await query('UPDATE users SET preferred_question_language=$1,updated_at=now() WHERE id=$2',[language,req.auth.user_id]);
    res.json({language});
  }));

  app.get('/api/v2/quiz-blueprints',requireAuth,route(async(req,res)=>{
    const {rows}=await transaction(c=>c.query('SELECT code,title,mode,question_count,duration_minutes,filters,internal_target_score FROM quiz_blueprints WHERE team_id=$1 AND active ORDER BY question_count,code',[req.auth.team_id]),scope(req));
    res.json(rows);
  }));

  app.get('/api/v2/simulations/eligibility',requireAuth,route(async(req,res)=>{
    const language=parse(z.object({language:questionLanguage.optional()}),req.query).language||req.auth.preferred_question_language||'pt-BR';
    const week=simulationWeek();
    const result=await transaction(async c=>{
      const certification=await activeCertification(c,req.auth.user_id);
      const used=(await c.query("SELECT id,started_at,status FROM simulations WHERE user_id=$1 AND mode='full' AND weekly_slot=$2 ORDER BY started_at LIMIT 1",[req.auth.user_id,week.weekStart])).rows[0]||null;
      let available={published:0,preview:0,categories:[],difficulties:[],domains:[],missed:0};
      if(certification){
        const row=(await c.query(`SELECT
          count(*) FILTER(WHERE q.status='published') published,
          count(*) FILTER(WHERE q.status IN ('published','review')) preview
          FROM questions q JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id
          WHERE qc.team_id=$1 AND qc.certification_id=$2 AND NOT q.revalidate AND NOT q.possible_stale
          AND EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id AND qs.validation_status='validated_content')
          AND ($3='pt-BR' OR EXISTS(SELECT 1 FROM question_translations qt WHERE qt.question_id=q.id AND qt.language=$3 AND qt.translation_status='reviewed'))`,[req.auth.team_id,certification.id,language])).rows[0];
        const categories=(await c.query(`SELECT DISTINCT q.category FROM questions q
          JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id
          WHERE qc.team_id=$1 AND qc.certification_id=$2 AND q.status IN ('published','review')
          ORDER BY q.category`,[req.auth.team_id,certification.id])).rows.map(item=>item.category);
        const difficulties=(await c.query(`SELECT DISTINCT q.difficulty FROM questions q
          JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id
          WHERE qc.team_id=$1 AND qc.certification_id=$2 AND q.status='published'
          ORDER BY q.difficulty`,[req.auth.team_id,certification.id])).rows.map(item=>item.difficulty);
        const domains=(await c.query(`SELECT q.category,count(*)::int count FROM questions q
          JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id
          WHERE qc.team_id=$1 AND qc.certification_id=$2 AND q.status='published'
            AND NOT q.revalidate AND NOT q.possible_stale
            AND EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id AND qs.validation_status='validated_content')
            AND ($3='pt-BR' OR EXISTS(SELECT 1 FROM question_translations qt WHERE qt.question_id=q.id AND qt.language=$3 AND qt.translation_status='reviewed'))
          GROUP BY q.category ORDER BY q.category`,[req.auth.team_id,certification.id,language])).rows;
        const missed=(await c.query(`SELECT count(DISTINCT q.id)::int count FROM questions q
          JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id
          JOIN answers a ON a.question_id=q.id JOIN simulations s ON s.id=a.simulation_id
          WHERE qc.team_id=$1 AND qc.certification_id=$2 AND s.certification_id=$2 AND s.user_id=$3 AND s.status='finished'
            AND NOT a.correct AND q.status='published' AND NOT q.revalidate AND NOT q.possible_stale
            AND EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id AND qs.validation_status='validated_content')
            AND ($4='pt-BR' OR EXISTS(SELECT 1 FROM question_translations qt WHERE qt.question_id=q.id AND qt.language=$4 AND qt.translation_status='reviewed'))`,
          [req.auth.team_id,certification.id,req.auth.user_id,language])).rows[0].count;
        available={published:Number(row.published),preview:Number(row.preview),categories,difficulties,domains,missed:Number(missed)};
      }
      return{certification,week,used,language,available,canStartFull:Boolean(certification&&!used&&available.published>=60)};
    },scope(req));
    res.json(result);
  }));

  app.get('/api/v2/simulations/reports',requireAuth,route(async(req,res)=>{
    const {rows}=await transaction(c=>c.query(`SELECT s.id,s.mode,s.started_at,s.finished_at,s.submitted_at,s.score,s.question_count,s.status,s.approval_status,s.decided_at,s.rejection_reason,
      ct.code certification_code,ct.short_title certification_title,
      (sr.simulation_id IS NOT NULL) has_report
      FROM simulations s LEFT JOIN certification_tracks ct ON ct.id=s.certification_id
      LEFT JOIN simulation_reports sr ON sr.simulation_id=s.id
      WHERE s.user_id=$1 AND s.status IN ('pending_approval','finished','rejected') ORDER BY COALESCE(s.submitted_at,s.finished_at) DESC LIMIT 24`,[req.auth.user_id]),scope(req));
    res.json(rows);
  }));

  app.get('/api/v2/simulations/:id/report',requireAuth,route(async(req,res)=>{
    const result=await transaction(async c=>{
      const simulation=(await c.query("SELECT * FROM simulations WHERE id=$1 AND user_id=$2 AND status IN ('pending_approval','finished','rejected')",[req.params.id,req.auth.user_id])).rows[0];
      if(!simulation)return null;
      return{report:await ensureSimulationReport(c,req,simulation),simulation};
    },scope(req));
    if(!result)return res.status(404).json({error:'Relatório não encontrado ou tentativa ainda em andamento.'});
    res.json({...result.report,approval:{status:result.simulation.approval_status,decidedAt:result.simulation.decided_at,rejectionReason:result.simulation.rejection_reason}});
  }));

  app.get('/api/goals/current',requireAuth,route(async(req,res)=>{
    const result=await transaction(async c=>{
      const certification=await activeCertification(c,req.auth.user_id);
      if(!certification)return null;
      const goal=(await c.query("SELECT * FROM goals WHERE user_id=$1 AND certification_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1",[req.auth.user_id,certification.id])).rows[0];
      if(!goal)return{goal:null,certification,availability:[],exceptions:[],scheduleStats:null,simulationDate:null,simulationDateSuggested:false};
      const [availability,exceptions,schedules]=await Promise.all([
        c.query('SELECT id,weekday,start_time,end_time,session_minutes,timezone FROM availability WHERE goal_id=$1 ORDER BY weekday,start_time',[goal.id]),
        c.query('SELECT id,exception_date,available,start_time,end_time,session_minutes,reason FROM availability_exceptions WHERE goal_id=$1 ORDER BY exception_date',[goal.id]),
        c.query(`SELECT count(*) revisions,max(created_at) last_recalculation,
          (SELECT count(*) FROM calendar_events ce JOIN schedules s ON s.id=ce.schedule_id WHERE s.goal_id=$1 AND s.superseded_at IS NULL AND ce.status='planned') planned_events
          FROM schedules WHERE goal_id=$1`,[goal.id])
      ]);
      return{goal,certification,availability:availability.rows,exceptions:exceptions.rows,scheduleStats:schedules.rows[0],simulationDate:practiceDate(goal),simulationDateSuggested:!goal.planned_simulation_date};
    },scope(req));
    res.json(result);
  }));

  app.post('/api/v2/plans/preview',requireAuth,requireCsrf,route(async(req,res)=>{
    const result=await transaction(async c=>{
      const certification=await activeCertification(c,req.auth.user_id);
      if(!certification)throw Object.assign(new Error('Escolha uma certificação antes de gerar o plano.'),{status:409});
      const goal=(await c.query("SELECT * FROM goals WHERE user_id=$1 AND certification_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1",[req.auth.user_id,certification.id])).rows[0];
      if(!goal)throw Object.assign(new Error(`Configure a meta para ${certification.code} antes de gerar o plano.`),{status:409});
      const windows=(await c.query('SELECT weekday,start_time::text "startTime",end_time::text "endTime",session_minutes "sessionMinutes",label,active FROM availability WHERE goal_id=$1 AND user_id=$2 ORDER BY weekday,start_time',[goal.id,req.auth.user_id])).rows;
      if(!windows.length)throw Object.assign(new Error('Nenhuma janela de estudo configurada.'),{status:409});
      const excluded=(await c.query("SELECT exception_date::text date FROM availability_exceptions WHERE goal_id=$1 AND NOT available",[goal.id])).rows.map(item=>item.date);
      const locked=(await c.query("SELECT ss.id,ss.notes title,ss.planned_start \"plannedStart\",ss.planned_end \"plannedEnd\",ss.planned_minutes,ss.priority FROM study_sessions ss JOIN schedules s ON s.id=ss.schedule_id JOIN goals g ON g.id=s.goal_id WHERE ss.user_id=$1 AND g.certification_id=$2 AND ss.locked AND ss.status<>'cancelled' AND ss.planned_start>=now()",[req.auth.user_id,certification.id])).rows;
      const activities=await evidenceActivities(c,req,certification);
      if(!activities.length)throw Object.assign(new Error(`Ainda não há documentos ou questões validadas para planejar ${certification.code}.`),{status:409});
      const completed=new Set((await c.query("SELECT entity_id::text FROM progress WHERE user_id=$1 AND entity_type='study_activity' AND status='completed'",[req.auth.user_id])).rows.map(item=>item.entity_id));
      const pending=activities.filter(item=>!completed.has(item.id));
      const simDate=practiceDate(goal);
      const plan=buildFlexiblePlan({targetDate:dateOnly(goal.target_date),windows,activities:pending,excludedDates:simDate?[...excluded,simDate]:excluded,lockedSessions:locked,settings:{minSessionMinutes:goal.min_session_minutes,maxSessionMinutes:goal.max_session_minutes,maxDailyMinutes:goal.max_daily_minutes,maxWeeklyMinutes:Math.min(goal.max_weekly_minutes,goal.weekly_minutes),gapMinutes:goal.session_gap_minutes,intensity:goal.intensity,weekendsEnabled:windows.some(x=>[0,6].includes(Number(x.weekday)))}});
      const preview=(await c.query(`INSERT INTO plan_previews(team_id,user_id,goal_id,payload,total_required_minutes,total_available_minutes,feasible,conflicts,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '2 hours') RETURNING id,expires_at`,[req.auth.team_id,req.auth.user_id,goal.id,JSON.stringify(plan),plan.requiredMinutes,plan.availableMinutes,plan.feasible,JSON.stringify(plan.conflicts)])).rows[0];
      return{...preview,...plan,goal:{id:goal.id,title:goal.title,targetDate:goal.target_date,simulationDate:simDate,certificationCode:certification.code},activityCount:pending.length,activityBreakdown:Object.fromEntries([...new Set(pending.map(x=>x.activityType))].map(type=>[type,pending.filter(x=>x.activityType===type).length]))};
    },scope(req));
    res.json(result);
  }));

  app.post('/api/goals',requireAuth,requireCsrf,route(async(req,res)=>{
    const body=parse(z.object({
      title:z.string().min(2).max(120).default('Meta de certificação'),
      targetDate:z.string().date(),
      plannedSimulationDate:z.string().date().optional(),
      targetScore:z.number().int().min(50).max(100).default(80),
      weeklyMinutes:z.number().int().min(30).max(2400).default(225),
      finalReviewDays:z.number().int().min(1).max(30).default(7),
      minSessionMinutes:z.number().int().min(10).max(180).default(20),
      maxSessionMinutes:z.number().int().min(20).max(240).default(90),
      maxDailyMinutes:z.number().int().min(20).max(720).default(180),
      maxWeeklyMinutes:z.number().int().min(30).max(3000).default(600),
      preferredPeriod:z.enum(['any','morning','afternoon','night']).default('any'),
      gapMinutes:z.number().int().min(0).max(180).default(15),
      intensity:z.enum(['light','balanced','intensive']).default('balanced'),
      weekendsEnabled:z.boolean().default(false),
      notes:z.string().max(2000).optional(),
      freeDates:z.array(z.string().date()).default([]),
      availability:z.array(z.object({
        weekday:z.number().int().min(0).max(6),
        startTime:z.string().regex(/^\d\d:\d\d$/),
        endTime:z.string().regex(/^\d\d:\d\d$/),
        sessionMinutes:z.number().int().min(10).max(240),
        label:z.string().max(80).optional()
      })).min(1).max(28)
    }),req.body);
    if(body.minSessionMinutes>body.maxSessionMinutes)throw Object.assign(new Error('A duração mínima não pode superar a máxima.'),{status:400});
    if(body.targetDate<=new Date().toISOString().slice(0,10))throw Object.assign(new Error('A data final da meta deve estar no futuro.'),{status:400});
    if(body.plannedSimulationDate&&(body.plannedSimulationDate<=new Date().toISOString().slice(0,10)||body.plannedSimulationDate>=body.targetDate))throw Object.assign(new Error('O simulado planejado deve ficar depois de hoje e antes da data final.'),{status:400});
    const goal=await transaction(async client=>{
      const certification=await activeCertification(client,req.auth.user_id);
      if(!certification)throw Object.assign(new Error('Escolha uma certificação antes de criar a meta.'),{status:409});
      await client.query(`UPDATE schedules SET superseded_at=now() WHERE user_id=$1 AND superseded_at IS NULL
        AND goal_id IN(SELECT id FROM goals WHERE user_id=$1 AND certification_id=$2)`,[req.auth.user_id,certification.id]);
      await client.query("UPDATE goals SET status='superseded',updated_at=now() WHERE user_id=$1 AND certification_id=$2 AND status='active'",[req.auth.user_id,certification.id]);
      const created=(await client.query(`
        INSERT INTO goals(
          team_id,user_id,title,target_date,target_score,weekly_minutes,final_review_days,notes,
          min_session_minutes,max_session_minutes,max_daily_minutes,max_weekly_minutes,
          preferred_period,session_gap_minutes,intensity,weekends_enabled,certification_id,planned_simulation_date
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING *
      `,[req.auth.team_id,req.auth.user_id,body.title,body.targetDate,body.targetScore,body.weeklyMinutes,body.finalReviewDays,body.notes||null,body.minSessionMinutes,body.maxSessionMinutes,body.maxDailyMinutes,body.weeklyMinutes,body.preferredPeriod,body.gapMinutes,body.intensity,body.availability.some(x=>[0,6].includes(x.weekday)),certification.id,body.plannedSimulationDate||null])).rows[0];
      for(const window of body.availability){
        if(window.endTime<=window.startTime)throw Object.assign(new Error(`Janela inválida em ${window.weekday}: o fim deve ser posterior ao início.`),{status:400});
        await client.query(`
          INSERT INTO availability(user_id,goal_id,weekday,start_time,end_time,session_minutes,label,active)
          VALUES($1,$2,$3,$4,$5,$6,$7,true)
        `,[req.auth.user_id,created.id,window.weekday,window.startTime,window.endTime,window.sessionMinutes,window.label||null]);
      }
      for(const date of body.freeDates){
        await client.query(`
          INSERT INTO availability_exceptions(team_id,user_id,goal_id,exception_date,available,reason)
          VALUES($1,$2,$3,$4,false,'Indisponibilidade informada pelo aluno')
          ON CONFLICT(goal_id,exception_date) DO NOTHING
        `,[req.auth.team_id,req.auth.user_id,created.id,date]);
      }
      await audit(client,req,'goal.flexible_created','goal',created.id,{windows:body.availability.length,targetDate:body.targetDate});
      return created;
    },scope(req));
    res.status(201).json(goal);
  }));

  // Registrada antes da implementação legada abaixo para manter compatibilidade
  // de rota e corrigir a tipagem do intervalo no PostgreSQL.
  app.post('/api/v2/simulations',requireAuth,requireCsrf,route(async(req,res)=>{
    const body=parse(z.object({
      mode:z.enum(['quick','domain','custom','adaptive','error_review','full']).default('quick'),
      certificationCode:z.string().regex(/^CC[A-Z]{2}$/).optional(),
      domain:z.string().min(1).max(200).optional(),
      language:questionLanguage.optional()
    }),req.body);
    body.language=body.language||req.auth.preferred_question_language||'pt-BR';
    body.categories=[];body.difficulties=[];body.formats=[];body.preview=false;
    Object.assign(body,simulationModePresets[body.mode]);
    const seed=randomToken(12);
    const week=simulationWeek();
    let result;
    try{result=await transaction(async client=>{
      const certification=await activeCertification(client,req.auth.user_id);
      if(!certification)throw Object.assign(new Error('Escolha uma certificação ativa antes de iniciar.'),{status:409});
      if(body.certificationCode&&body.certificationCode!==certification.code)throw Object.assign(new Error('A certificação ativa mudou. Atualize a página antes de iniciar.'),{status:409});
      const active=(await client.query("SELECT id FROM simulations WHERE user_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",[req.auth.user_id])).rows[0];
      if(active)throw Object.assign(new Error('Há uma tentativa em andamento. Continue ou entregue-a antes de iniciar outra.'),{status:409,activeSimulationId:active.id});
      if(body.mode==='full'){
        const used=(await client.query("SELECT id FROM simulations WHERE user_id=$1 AND mode='full' AND weekly_slot=$2 LIMIT 1",[req.auth.user_id,week.weekStart])).rows[0];
        if(used)throw Object.assign(new Error(`O simulado completo desta semana já foi iniciado. Próxima janela: ${week.nextWeekStart} (${week.timeZone}).`),{status:409,nextEligible:week.nextWeekStart});
      }
      const allowed=['published'];
      let candidates=(await client.query(`
        SELECT q.id,q.version,q.category,q.difficulty
        FROM questions q JOIN question_certifications qc ON qc.question_id=q.id AND qc.team_id=q.team_id
        WHERE q.team_id=$1
          AND qc.certification_id=$8
          AND q.status=ANY($2::text[])
          AND NOT q.revalidate
          AND NOT q.possible_stale
          AND EXISTS(
            SELECT 1 FROM question_sources qs
            WHERE qs.question_id=q.id AND qs.validation_status='validated_content'
          )
          AND ($6='pt-BR' OR EXISTS(
            SELECT 1 FROM question_translations qt
            WHERE qt.question_id=q.id AND qt.language=$6 AND qt.translation_status='reviewed'
          ))
          AND (cardinality($3::text[])=0 OR q.category=ANY($3::text[]))
          AND (cardinality($4::text[])=0 OR q.difficulty=ANY($4::text[]))
          AND (cardinality($7::text[])=0 OR q.format=ANY($7::text[]))
          AND ($9<>'error_review' OR EXISTS(
            SELECT 1 FROM answers missed JOIN simulations previous ON previous.id=missed.simulation_id
            WHERE previous.user_id=$5 AND previous.certification_id=$8 AND previous.status='finished' AND missed.question_id=q.id AND NOT missed.correct
          ))
        ORDER BY EXISTS(
          SELECT 1 FROM attempts a
          WHERE a.user_id=$5 AND a.question_id=q.id
            AND a.created_at>now()-interval '14 days'
        ),q.category,q.difficulty
      `,[req.auth.team_id,allowed,body.categories,body.difficulties,req.auth.user_id,body.language,body.formats,certification.id,body.mode])).rows;
      if(body.mode==='domain'){
        const selected=selectSimulationDomain(candidates,body.domain,body.count);
        body.categories=[selected.domain];candidates=selected.candidates;
      }
      if(body.mode==='adaptive'){
        const weaknesses=(await client.query(`SELECT q.category,
          count(*) FILTER(WHERE NOT a.correct)::int mistakes,count(*)::int attempts
          FROM answers a JOIN simulations s ON s.id=a.simulation_id
          JOIN questions q ON q.id=a.question_id
          WHERE s.user_id=$1 AND s.status='finished' AND s.certification_id=$2
          GROUP BY q.category ORDER BY count(*) FILTER(WHERE NOT a.correct)::float/nullif(count(*),0) DESC,attempts DESC LIMIT 3`,
        [req.auth.user_id,certification.id])).rows;
        const weak=new Set(weaknesses.filter(x=>Number(x.mistakes)>0).map(x=>x.category));
        const focused=candidates.filter(x=>weak.has(x.category));
        if(focused.length>=body.count)candidates=focused;
      }
      const selected=balancedSelection(candidates,body.count,seed);
      if(selected.length<body.count)throw Object.assign(new Error(`Este modo requer ${body.count} questões; há ${selected.length} disponíveis neste idioma e histórico.`),{status:409,available:selected.length});
      const simulation=(await client.query(`
        INSERT INTO simulations(
          team_id,user_id,mode,seed,question_count,duration_minutes,
          category_filter,difficulty_filter,deadline_at,last_autosave_at,preview_mode,language,
          blueprint_id,internal_target_score,source_label,certification_id,weekly_slot
        ) VALUES(
          $1,$2,$3,$4,$5,$6,$7,$8,
          now()+make_interval(mins=>$6::int),now(),$9,$10,$11,$12,$13,$14,$15
        ) RETURNING *
      `,[req.auth.team_id,req.auth.user_id,body.mode,seed,body.count,body.durationMinutes,JSON.stringify(body.categories),JSON.stringify(body.difficulties),body.preview,body.language,null,null,null,certification.id,body.mode==='full'?week.weekStart:null])).rows[0];
      for(const [index,question] of selected.entries()){
        await client.query(
          'INSERT INTO simulation_questions(simulation_id,question_id,question_version,position) VALUES($1,$2,$3,$4)',
          [simulation.id,question.id,question.version,index+1]
        );
      }
      await client.query(
        "INSERT INTO simulation_events(team_id,simulation_id,user_id,event_type,payload) VALUES($1,$2,$3,'started',$4)",
        [req.auth.team_id,simulation.id,req.auth.user_id,JSON.stringify({mode:body.mode,count:body.count,seed,language:body.language,certification:certification.code})]
      );
      return simulation;
    },scope(req));}catch(error){
      if(error.code==='23505'&&String(error.constraint||'').includes('simulations_one_full_per_user_week'))throw Object.assign(new Error(`O simulado completo desta semana já foi iniciado. Próxima janela: ${week.nextWeekStart} (${week.timeZone}).`),{status:409});
      throw error;
    }
    res.status(201).json(result);
  }));

  app.put('/api/v2/simulations/:id/autosave',requireAuth,requireCsrf,route(async(req,res)=>{
    const body=parse(z.object({
      questionId:z.string().uuid(),answer:z.any(),position:z.number().int().min(1),
      elapsedSeconds:z.number().int().min(0).max(7200).default(0),
      confidence:z.number().int().min(1).max(5).optional(),marked:z.boolean().default(false)
    }),req.body);
    const result=await transaction(async client=>{
      const simulation=(await client.query(
        "SELECT * FROM simulations WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE",
        [req.params.id,req.auth.user_id]
      )).rows[0];
      if(!simulation)throw Object.assign(new Error('Tentativa finalizada ou inexistente.'),{status:409});
      if(simulation.deadline_at&&new Date(simulation.deadline_at)<=new Date())throw Object.assign(new Error('O tempo do servidor terminou. Entregue a tentativa.'),{status:409});
      const question=(await client.query(`
        SELECT q.*,COALESCE(qt.explanation,q.explanation) localized_explanation
        FROM simulation_questions sq
        JOIN questions q ON q.id=sq.question_id
        LEFT JOIN question_translations qt ON qt.question_id=q.id AND qt.language=$3 AND qt.translation_status='reviewed'
        WHERE sq.simulation_id=$1 AND q.id=$2
      `,[simulation.id,body.questionId,simulation.language||'pt-BR'])).rows[0];
      if(!question)throw Object.assign(new Error('Questão fora desta tentativa.'),{status:400});
      const correct=sameAnswer(question.correct_answer,body.answer);
      await client.query(`
        INSERT INTO answers(simulation_id,question_id,user_id,answer,correct,elapsed_seconds,confidence,marked_for_review)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(simulation_id,question_id) DO UPDATE SET
          answer=EXCLUDED.answer,correct=EXCLUDED.correct,elapsed_seconds=EXCLUDED.elapsed_seconds,
          confidence=EXCLUDED.confidence,marked_for_review=EXCLUDED.marked_for_review,answered_at=now()
      `,[simulation.id,question.id,req.auth.user_id,JSON.stringify(body.answer),correct,body.elapsedSeconds,body.confidence||null,body.marked]);
      await client.query('UPDATE simulations SET current_position=$1,last_autosave_at=now() WHERE id=$2',[body.position,simulation.id]);
      await client.query(
        "INSERT INTO simulation_events(team_id,simulation_id,user_id,event_type,position,payload) VALUES($1,$2,$3,'autosave',$4,$5)",
        [req.auth.team_id,simulation.id,req.auth.user_id,body.position,JSON.stringify({marked:body.marked})]
      );
      const reveal=simulation.mode==='quick'||simulation.preview_mode;
      const source=reveal?(await client.query(`
        SELECT source_title title,source_version version,page_number page,section,excerpt,source_url "sourceUrl"
        FROM question_sources WHERE question_id=$1 ORDER BY consulted_at DESC LIMIT 1
      `,[question.id])).rows[0]:null;
      const english=(simulation.language||'pt-BR')==='en-US';
      const citation=source?` ${english?'Source':'Fonte'}: ${source.title}${source.version?` · ${source.version}`:''}${source.page?` · ${english?'page':'página'} ${source.page}`:source.section?` · ${english?'section':'seção'} ${source.section}`:''}.`:'';
      return{saved:true,correct:reveal?correct:undefined,explanation:reveal?`${question.localized_explanation}${citation}`:undefined,source,language:simulation.language||'pt-BR'};
    },scope(req));
    res.json(result);
  }));

  app.post('/api/v2/simulations/:id/submit',requireAuth,requireCsrf,route(async(req,res)=>{
    const result=await transaction(async client=>{
      const simulation=(await client.query('SELECT * FROM simulations WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.auth.user_id])).rows[0];
      if(!simulation)throw Object.assign(new Error('Tentativa não encontrada.'),{status:404});
      if(simulation.status!=='active')return{...(await ensureSimulationReport(client,req,simulation)),approval:{status:simulation.approval_status,decidedAt:simulation.decided_at,rejectionReason:simulation.rejection_reason}};
      const counts=(await client.query('SELECT count(*) answered,count(*) FILTER(WHERE correct) correct FROM answers WHERE simulation_id=$1',[simulation.id])).rows[0];
      const score=Number(simulation.question_count)?Number(counts.correct)/Number(simulation.question_count)*100:0;
      const finished=(await client.query(
        "UPDATE simulations SET status='pending_approval',approval_status='pending',finished_at=now(),submitted_at=now(),score=$1 WHERE id=$2 RETURNING *",
        [score,simulation.id]
      )).rows[0];
      await client.query(`INSERT INTO attempts(team_id,user_id,simulation_id,question_id,question_version,correct,elapsed_seconds,confidence)
        SELECT $1,$2,$3,a.question_id,sq.question_version,a.correct,a.elapsed_seconds,a.confidence
        FROM answers a JOIN simulation_questions sq ON sq.simulation_id=a.simulation_id AND sq.question_id=a.question_id
        WHERE a.simulation_id=$3 AND NOT EXISTS(
          SELECT 1 FROM attempts previous WHERE previous.simulation_id=$3 AND previous.question_id=a.question_id
        )`,[req.auth.team_id,req.auth.user_id,simulation.id]);
      await client.query(
        "INSERT INTO simulation_events(team_id,simulation_id,user_id,event_type,payload) VALUES($1,$2,$3,'submitted',$4)",
        [req.auth.team_id,simulation.id,req.auth.user_id,JSON.stringify({score,answered:Number(counts.answered)})]
      );
      await audit(client,req,'simulation.submitted','simulation',simulation.id,{score:Number(score.toFixed(1)),answered:Number(counts.answered)});
      return{...(await ensureSimulationReport(client,req,finished)),approval:{status:'pending',decidedAt:null,rejectionReason:null}};
    },scope(req));
    res.json(result);
  }));

  app.get('/api/v2/question-bank/summary',requireAuth,route(async(req,res)=>{
    const language=parse(z.object({language:questionLanguage.optional()}),req.query).language||req.auth.preferred_question_language||'pt-BR';
    const result=await transaction(c=>Promise.all([
      c.query("SELECT status,count(*) n FROM questions WHERE team_id=$1 GROUP BY status",[req.auth.team_id]),
      c.query("SELECT category,difficulty,status,count(*) n FROM questions WHERE team_id=$1 AND status<>'archived' GROUP BY category,difficulty,status ORDER BY category,difficulty",[req.auth.team_id]),
      c.query("SELECT count(*) FILTER(WHERE status='published' AND NOT revalidate AND NOT possible_stale AND EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id)) published,count(*) FILTER(WHERE status='review' AND NOT revalidate AND NOT possible_stale AND EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id)) review,count(*) FILTER(WHERE status<>'archived' AND generated_by_ai) ai_generated,count(*) FILTER(WHERE status<>'archived' AND NOT EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id)) without_evidence FROM questions q WHERE team_id=$1",[req.auth.team_id]),
      c.query("SELECT count(*) FILTER(WHERE q.status='published' AND NOT q.revalidate AND NOT q.possible_stale) published,count(*) FILTER(WHERE q.status='review' AND NOT q.revalidate AND NOT q.possible_stale) review FROM question_translations qt JOIN questions q ON q.id=qt.question_id WHERE q.team_id=$1 AND qt.language='en-US' AND qt.translation_status='reviewed'",[req.auth.team_id])
    ]),scope(req));const totals=result[2].rows[0],english=result[3].rows[0],languageAvailability={'pt-BR':{published:Number(totals.published),review:Number(totals.review)},'en-US':{published:Number(english.published),review:Number(english.review)}},selected=languageAvailability[language];res.json({byStatus:result[0].rows,coverage:result[1].rows,totals,languageAvailability,simulationAvailability:{language,published:selected.published,reviewPreview:req.auth.role==='admin_reviewer'?selected.review:0,quantities:[10,20,40,60].map(count=>({count,published:selected.published>=count,preview:selected.published+(req.auth.role==='admin_reviewer'?selected.review:0)>=count}))}});
  }));

  app.get('/api/v2/question-bank/report',requireAuth,allow('admin_reviewer'),route(async(req,res)=>{
    const result=await transaction(c=>Promise.all([
      c.query(`SELECT official_domain domain,count(*) total,count(*) FILTER(WHERE status='review') awaiting_review,count(*) FILTER(WHERE status='published') published FROM questions WHERE team_id=$1 AND question_code LIKE 'CCFA-2026-%' GROUP BY official_domain ORDER BY official_domain`,[req.auth.team_id]),
      c.query(`SELECT difficulty,count(*) total FROM questions WHERE team_id=$1 AND question_code LIKE 'CCFA-2026-%' GROUP BY difficulty ORDER BY difficulty`,[req.auth.team_id]),
      c.query(`SELECT format,count(*) total FROM questions WHERE team_id=$1 AND question_code LIKE 'CCFA-2026-%' GROUP BY format ORDER BY format`,[req.auth.team_id]),
      c.query(`SELECT code,title,question_count,duration_minutes,filters,internal_target_score FROM quiz_blueprints WHERE team_id=$1 AND active ORDER BY question_count,code`,[req.auth.team_id]),
      c.query(`SELECT title,url,consulted_at,warning,themes,content_stored,technical_source_allowed FROM external_topic_references WHERE team_id=$1 ORDER BY consulted_at DESC`,[req.auth.team_id]),
      c.query(`SELECT stats,finished_at FROM import_runs WHERE team_id=$1 AND source='ccfa_question_bank_v1' ORDER BY started_at DESC LIMIT 1`,[req.auth.team_id])
    ]),scope(req));
    res.json({domains:result[0].rows,difficulties:result[1].rows,formats:result[2].rows,blueprints:result[3].rows,externalReferences:result[4].rows,lastGeneration:result[5].rows[0]||null,distributionNotice:'Distribuição interna de estudo; não representa peso oficial do exame.'});
  }));

  app.get('/api/v2/questions',requireAuth,allow('admin_reviewer'),route(async(req,res)=>{const b=parse(z.object({status:z.string().max(20).default('review'),category:z.string().max(100).default(''),difficulty:z.string().max(30).default(''),documentId:z.string().uuid().optional(),language:questionLanguage.optional()}),req.query),language=b.language||req.auth.preferred_question_language||'pt-BR';const {rows}=await transaction(c=>c.query(`SELECT q.*,COALESCE(qt.prompt,q.prompt) prompt,COALESCE(qt.options,q.options) options,COALESCE(qt.explanation,q.explanation) explanation,COALESCE(qt.distractor_explanations,q.distractor_explanations) distractor_explanations,$6::text language,($6='pt-BR' OR qt.id IS NOT NULL) translation_available,coalesce(json_agg(json_build_object('versionId',qs.version_id,'sourceType',qs.source_type,'title',qs.source_title,'version',qs.source_version,'url',qs.source_url,'path',qs.relative_path,'page',qs.page_number,'section',qs.section,'excerpt',qs.excerpt,'consultedAt',qs.consulted_at,'validation',qs.validation_status)) FILTER(WHERE qs.question_id IS NOT NULL),'[]') sources
    FROM questions q LEFT JOIN question_translations qt ON qt.question_id=q.id AND qt.language=$6 AND qt.translation_status='reviewed' LEFT JOIN question_sources qs ON qs.question_id=q.id LEFT JOIN document_versions dv ON dv.id=qs.version_id
    WHERE q.team_id=$1 AND ($2='' OR q.status=$2) AND ($3='' OR q.category=$3) AND ($4='' OR q.difficulty=$4) AND ($5::uuid IS NULL OR dv.document_id=$5) AND ($6='pt-BR' OR qt.id IS NOT NULL)
    GROUP BY q.id,qt.id ORDER BY q.created_at DESC LIMIT 300`,[req.auth.team_id,b.status,b.category,b.difficulty,b.documentId||null,language]),scope(req));res.json(rows);}));

  app.patch('/api/v2/questions/:id',requireAuth,requireCsrf,allow('admin_reviewer'),route(async(req,res)=>{
    const b=parse(z.object({prompt:z.string().min(10).max(2000),options:z.array(z.string().min(1)).min(2).max(10),correctAnswer:z.any(),explanation:z.string().min(10).max(5000),distractorExplanations:z.array(z.string()).default([]),category:z.string().min(2).max(100),subcategory:z.string().max(100).optional(),difficulty:z.enum(['fácil','intermediária','difícil']),format:z.string().min(2).max(60),language:questionLanguage.optional()}),req.body);
    b.language=b.language||req.auth.preferred_question_language||'pt-BR';
    const row=await transaction(async c=>{
      const q=(await c.query('SELECT * FROM questions WHERE id=$1 AND team_id=$2 FOR UPDATE',[req.params.id,req.auth.team_id])).rows[0];
      if(!q)throw Object.assign(new Error('Questão não encontrada.'),{status:404});
      const correctCount=Array.isArray(b.correctAnswer)?b.correctAnswer.length:1;
      await c.query('UPDATE questions SET correct_answer=$1,correct_count=$2,category=$3,subcategory=$4,difficulty=$5,format=$6,version=version+1,updated_at=now() WHERE id=$7',[JSON.stringify(b.correctAnswer),correctCount,b.category,b.subcategory||null,b.difficulty,b.format,q.id]);
      if(b.language==='pt-BR'){
        await c.query('UPDATE questions SET prompt=$1,options=$2,explanation=$3,distractor_explanations=$4 WHERE id=$5',[b.prompt,JSON.stringify(b.options),b.explanation,JSON.stringify(b.distractorExplanations),q.id]);
      }else{
        await c.query(`INSERT INTO question_translations(question_id,language,prompt,options,explanation,distractor_explanations,translation_status,translation_method,reviewed_by,reviewed_at)
          VALUES($1,$2,$3,$4,$5,$6,'reviewed','manual',$7,now())
          ON CONFLICT(question_id,language) DO UPDATE SET prompt=EXCLUDED.prompt,options=EXCLUDED.options,explanation=EXCLUDED.explanation,distractor_explanations=EXCLUDED.distractor_explanations,translation_status='reviewed',translation_method='manual',reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now(),updated_at=now()`,[q.id,b.language,b.prompt,JSON.stringify(b.options),b.explanation,JSON.stringify(b.distractorExplanations),req.auth.user_id]);
      }
      await c.query("INSERT INTO reviews(team_id,question_id,reviewer_id,decision,comment) VALUES($1,$2,$3,'edited',$4)",[req.auth.team_id,q.id,req.auth.user_id,`Conteúdo editorial atualizado em ${b.language}`]);
      await audit(c,req,'question.edited','question',q.id,{version:Number(q.version)+1,language:b.language});
      return{...q,version:Number(q.version)+1,language:b.language};
    },scope(req));
    res.json(row);
  }));

  app.post('/api/v2/questions/bulk-review',requireAuth,requireCsrf,allow('admin_reviewer'),route(async(req,res)=>{
    const b=parse(z.object({ids:z.array(z.string().uuid()).min(1).max(100),decision:z.enum(['approved','published','rejected','archived','correction_requested']),comment:z.string().max(1000).optional()}),req.body);
    const result=await transaction(async c=>{
      const invalid=(await c.query(`
        SELECT q.id FROM questions q
        WHERE q.team_id=$1 AND q.id=ANY($2::uuid[]) AND (
          NOT EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id AND length(qs.excerpt)>=40 AND qs.validation_status='validated_content')
          OR jsonb_typeof(q.options)<>'array' OR jsonb_array_length(q.options)<>4
          OR NOT (
            (jsonb_typeof(q.correct_answer)='number' AND q.correct_count=1
              AND (q.correct_answer#>>'{}')::int BETWEEN 0 AND jsonb_array_length(q.options)-1)
            OR
            (jsonb_typeof(q.correct_answer)='array' AND jsonb_array_length(q.correct_answer)=q.correct_count
              AND q.correct_count>1 AND NOT EXISTS(
                SELECT 1 FROM jsonb_array_elements(q.correct_answer) answer
                WHERE jsonb_typeof(answer.value)<>'number'
                  OR CASE WHEN jsonb_typeof(answer.value)='number' THEN (answer.value#>>'{}')::int NOT BETWEEN 0 AND jsonb_array_length(q.options)-1 ELSE true END
              ))
          )
          OR (SELECT count(*) FROM jsonb_array_elements_text(q.options))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(q.options) value)
          OR length(trim(q.prompt))<30 OR q.prompt ILIKE 'Com base exclusivamente em%'
        )`,[req.auth.team_id,b.ids])).rows;
      if(['approved','published'].includes(b.decision)&&invalid.length)throw Object.assign(new Error(`${invalid.length} questão(ões) falharam na validação: evidência, quatro alternativas únicas, quantidade de respostas e enunciado contextualizado são obrigatórios.`),{status:409});
      const rows=(await c.query(`UPDATE questions SET status=$1,reviewer_id=$2,reviewed_at=now(),approved_by=CASE WHEN $1 IN ('approved','published') THEN $2 ELSE approved_by END,approved_at=CASE WHEN $1 IN ('approved','published') THEN now() ELSE approved_at END,revalidate=CASE WHEN $1 IN ('approved','published') THEN false ELSE revalidate END,possible_stale=CASE WHEN $1 IN ('approved','published') THEN false ELSE possible_stale END,updated_at=now() WHERE team_id=$3 AND id=ANY($4::uuid[]) RETURNING id`,[b.decision,req.auth.user_id,req.auth.team_id,b.ids])).rows;
      for(const row of rows)await c.query('INSERT INTO reviews(team_id,question_id,reviewer_id,decision,comment) VALUES($1,$2,$3,$4,$5)',[req.auth.team_id,row.id,req.auth.user_id,b.decision,b.comment||null]);
      await audit(c,req,'question.bulk_reviewed','question_batch',null,{decision:b.decision,count:rows.length});return rows.length;
    },scope(req));
    res.json({updated:result,decision:b.decision});
  }));

  // A versão nova preserva planos de outras certificações e registra módulos confirmados.
  app.post('/api/v2/plans/:id/apply',requireAuth,requireCsrf,route(async(req,res)=>{
    const result=await transaction(async c=>{
      const preview=(await c.query(`SELECT p.*,g.certification_id FROM plan_previews p JOIN goals g ON g.id=p.goal_id
        WHERE p.id=$1 AND p.user_id=$2 AND p.team_id=$3 AND p.applied_at IS NULL AND p.expires_at>now()
        AND g.status='active' FOR UPDATE OF p`,[req.params.id,req.auth.user_id,req.auth.team_id])).rows[0];
      if(!preview)throw Object.assign(new Error('Prévia expirada, substituída ou já aplicada.'),{status:409});
      if(!preview.feasible)throw Object.assign(new Error('O plano não cabe antes da data-meta. Ajuste disponibilidade ou data-meta.'),{status:409});
      await c.query(`UPDATE schedules SET superseded_at=now() WHERE user_id=$1 AND superseded_at IS NULL
        AND goal_id IN(SELECT id FROM goals WHERE user_id=$1 AND certification_id=$2)`,[req.auth.user_id,preview.certification_id]);
      const schedule=(await c.query(`INSERT INTO schedules(user_id,goal_id,revision,reason)
        VALUES($1,$2,COALESCE((SELECT max(revision)+1 FROM schedules WHERE user_id=$1),1),'Plano por certificação com módulos, questões e prática') RETURNING *`,[req.auth.user_id,preview.goal_id])).rows[0];
      let created=0;
      for(const session of preview.payload.sessions.filter(x=>!x.preserved)){
        const courseId=session.activities.find(x=>x.courseId)?.courseId||null;
        const study=(await c.query(`INSERT INTO study_sessions(team_id,user_id,course_id,activity_type,planned_minutes,planned_at,schedule_id,status,planned_start,planned_end,priority,locked,fixed_by_user,timezone,sync_identifier,notes)
          VALUES($1,$2,$3,$4,$5,$6,$7,'planned',$6,$8,$9,false,false,'America/Sao_Paulo',$10,$11) RETURNING *`,
          [req.auth.team_id,req.auth.user_id,courseId,session.activityType,session.plannedMinutes,session.plannedStart,schedule.id,session.plannedEnd,session.priority,`falcon-session-${session.id}`,session.title])).rows[0];
        let position=0;
        for(const activity of session.activities){
          const stored=(await c.query(`INSERT INTO study_activities(team_id,course_id,submodule_id,activity_type,title,objective,topic,instructions,key_concepts,completion_criteria,deliverable,estimated_minutes,priority,prerequisite_order,document_id,version_id,page_number,section,excerpt,question_category,question_count,query_exercise_id,lab_id,curator_status,source_fingerprint)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
            ON CONFLICT(team_id,source_fingerprint) DO UPDATE SET updated_at=now() RETURNING id`,
            [req.auth.team_id,activity.courseId||null,activity.submoduleId||null,activity.activityType,activity.title,activity.objective,activity.topic,activity.instructions,JSON.stringify(activity.keyConcepts||[]),activity.completionCriteria,activity.deliverable||null,activity.estimatedMinutes,activity.priority||3,activity.prerequisiteOrder||0,activity.documentId||null,activity.versionId||null,activity.pageNumber||null,activity.section||null,activity.excerpt||null,activity.questionCategory||null,activity.questionCount||null,activity.queryExerciseId||null,activity.labId||null,activity.curatorStatus||'ready',activity.sourceFingerprint])).rows[0];
          await c.query('INSERT INTO study_session_activities(team_id,session_id,activity_id,position,planned_minutes,split_part) VALUES($1,$2,$3,$4,$5,$6)',[req.auth.team_id,study.id,stored.id,++position,activity.plannedMinutes,activity.splitPart||1]);
        }
        await c.query(`INSERT INTO calendar_events(schedule_id,user_id,activity_type,reference_id,title,planned_start,planned_end,study_session_id,priority,estimated_minutes,locked,icon,color_key,sync_identifier)
          VALUES($1,$2,'study_session',$3,$4,$5,$6,$3,$7,$8,false,$9,$10,$11)`,
          [schedule.id,req.auth.user_id,study.id,session.title,session.plannedStart,session.plannedEnd,session.priority,session.plannedMinutes,session.activityType==='module'?'▦':session.activityType==='lab'?'⌘':session.activityType==='quiz'?'?':'◫',session.activityType,`falcon-session-${session.id}`]);
        created++;
      }
      await c.query('UPDATE plan_previews SET applied_at=now() WHERE id=$1',[preview.id]);
      await audit(c,req,'schedule.flexible_applied','schedule',schedule.id,{sessions:created,previewId:preview.id});
      return{schedule,created};
    },scope(req));
    res.status(201).json(result);
  }));

  app.get('/api/v2/calendar',requireAuth,route(async(req,res)=>{
    const b=parse(z.object({from:z.string().date(),to:z.string().date(),scope:z.enum(['mine','team']).default('mine'),status:z.string().max(30).default('')}),req.query);
    if(b.scope==='team'&&!['manager','admin_reviewer'].includes(req.auth.role))return res.status(403).json({error:'Calendário da equipe exige perfil gestor.'});
    const rows=await transaction(async c=>{
      const certification=await activeCertification(c,req.auth.user_id);
      if(!certification)return[];
      const sessions=(await c.query(`SELECT ss.id,ss.user_id,u.display_name,ss.status,ss.planned_start,ss.planned_end,
        ss.planned_minutes,ss.actual_minutes,ss.priority,ss.locked,ss.notes title,ss.activity_type,ss.sync_identifier,
        COALESCE(json_agg(json_build_object('id',sa.id,'title',sa.title,'type',sa.activity_type,
          'objective',sa.objective,'topic',sa.topic,'instructions',sa.instructions,'keyConcepts',sa.key_concepts,
          'completionCriteria',sa.completion_criteria,'deliverable',sa.deliverable,'minutes',ssa.planned_minutes,
          'status',ssa.status,'courseId',sa.course_id,'submoduleId',sa.submodule_id,
          'documentId',sa.document_id,'versionId',sa.version_id,'page',sa.page_number,'section',sa.section,
          'excerpt',sa.excerpt,'questionCategory',sa.question_category,'questionCount',sa.question_count,
          'queryExerciseId',sa.query_exercise_id,'labId',sa.lab_id) ORDER BY ssa.position)
          FILTER(WHERE sa.id IS NOT NULL),'[]') activities
        FROM study_sessions ss JOIN users u ON u.id=ss.user_id JOIN schedules sch ON sch.id=ss.schedule_id
        JOIN goals g ON g.id=sch.goal_id
        LEFT JOIN study_session_activities ssa ON ssa.session_id=ss.id
        LEFT JOIN study_activities sa ON sa.id=ssa.activity_id
        WHERE ss.team_id=$1 AND ($2='team' OR ss.user_id=$3)
          AND g.certification_id=$7 AND ss.planned_start >= $4::date AND ss.planned_start < $5::date+1
          AND ($6='' OR ss.status=$6) AND (sch.superseded_at IS NULL OR ss.locked OR ss.status='completed')
        GROUP BY ss.id,u.display_name ORDER BY ss.planned_start`,
        [req.auth.team_id,b.scope,req.auth.user_id,b.from,b.to,b.status,certification.id])).rows;
      if(b.scope==='mine'){
        const goal=(await c.query("SELECT * FROM goals WHERE user_id=$1 AND certification_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1",[req.auth.user_id,certification.id])).rows[0];
        if(goal)for(const milestone of goalMilestones(goal,certification)){
          const day=dateOnly(milestone.planned_start);
          if(day>=b.from&&day<=b.to&&(!b.status||b.status===milestone.status))sessions.push(milestone);
        }
        const simulations=(await c.query(`SELECT id,started_at,finished_at,score FROM simulations
          WHERE user_id=$1 AND certification_id=$2 AND mode='full' AND status='finished'
          AND started_at >= $3::date AND started_at < $4::date+1`,
          [req.auth.user_id,certification.id,b.from,b.to])).rows;
        if(!b.status||b.status==='completed')for(const sim of simulations)sessions.push({id:`sim-result-${sim.id}`,kind:'simulation_result',status:'completed',activity_type:'simulation',title:`Simulado concluído · ${certification.code} · ${Number(sim.score||0).toFixed(0)}%`,planned_start:sim.started_at,planned_end:sim.finished_at||sim.started_at,planned_minutes:90,priority:5,locked:true,activities:[]});
      }
      return sessions.sort((a,b)=>new Date(a.planned_start)-new Date(b.planned_start));
    },scope(req));
    res.json(rows);
  }));

  app.get('/api/v2/calendar/export.ics',requireAuth,route(async(req,res)=>{
    const rows=await transaction(async c=>{
      const certification=await activeCertification(c,req.auth.user_id);
      if(!certification)return[];
      const sessions=(await c.query(`SELECT ss.* FROM study_sessions ss JOIN schedules s ON s.id=ss.schedule_id
        JOIN goals g ON g.id=s.goal_id WHERE ss.user_id=$1 AND g.certification_id=$2
        AND ss.status<>'cancelled' AND ss.planned_start IS NOT NULL
        AND (s.superseded_at IS NULL OR ss.locked OR ss.status='completed') ORDER BY ss.planned_start`,
        [req.auth.user_id,certification.id])).rows;
      const goal=(await c.query("SELECT * FROM goals WHERE user_id=$1 AND certification_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1",[req.auth.user_id,certification.id])).rows[0];
      return goal?[...sessions,...goalMilestones(goal,certification)]:sessions;
    },scope(req));
    res.type('text/calendar').attachment('agenda-falcon-admin.ics').send(toStableIcs(rows));
  }));

  app.post('/api/v2/plans/preview',requireAuth,requireCsrf,route(async(req,res)=>{const result=await transaction(async c=>{const goal=(await c.query("SELECT * FROM goals WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1",[req.auth.user_id])).rows[0];if(!goal)throw Object.assign(new Error('Configure a disponibilidade e a data-meta antes de gerar o plano.'),{status:409});const windows=(await c.query('SELECT weekday,start_time::text "startTime",end_time::text "endTime",session_minutes "sessionMinutes",label,active FROM availability WHERE goal_id=$1 AND user_id=$2 ORDER BY weekday,start_time',[goal.id,req.auth.user_id])).rows;if(!windows.length)throw Object.assign(new Error('Nenhuma janela de estudo configurada.'),{status:409});const excluded=(await c.query('SELECT exception_date::text date FROM availability_exceptions WHERE goal_id=$1 AND NOT available',[goal.id])).rows.map(x=>x.date);const locked=(await c.query("SELECT id,title,planned_start \"plannedStart\",planned_end \"plannedEnd\",planned_minutes,priority FROM study_sessions WHERE user_id=$1 AND locked AND status<>'cancelled' AND planned_start>=now()",[req.auth.user_id])).rows;const activities=await evidenceActivities(c,req);const completed=new Set((await c.query("SELECT entity_id::text FROM progress WHERE user_id=$1 AND entity_type='study_activity' AND status='completed'",[req.auth.user_id])).rows.map(x=>x.entity_id));const pending=activities.filter(x=>!completed.has(x.id));const plan=buildFlexiblePlan({targetDate:goal.target_date.toISOString().slice(0,10),windows,activities:pending,excludedDates:excluded,lockedSessions:locked,settings:{minSessionMinutes:goal.min_session_minutes,maxSessionMinutes:goal.max_session_minutes,maxDailyMinutes:goal.max_daily_minutes,maxWeeklyMinutes:goal.max_weekly_minutes,gapMinutes:goal.session_gap_minutes,intensity:goal.intensity,weekendsEnabled:goal.weekends_enabled}});const preview=(await c.query(`INSERT INTO plan_previews(team_id,user_id,goal_id,payload,total_required_minutes,total_available_minutes,feasible,conflicts,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '2 hours') RETURNING id,expires_at`,[req.auth.team_id,req.auth.user_id,goal.id,JSON.stringify(plan),plan.requiredMinutes,plan.availableMinutes,plan.feasible,JSON.stringify(plan.conflicts)])).rows[0];return{...preview,...plan,goal:{id:goal.id,title:goal.title,targetDate:goal.target_date},activityCount:pending.length};},scope(req));res.json(result);}));

  app.post('/api/v2/plans/:id/apply',requireAuth,requireCsrf,route(async(req,res)=>{const result=await transaction(async c=>{const preview=(await c.query('SELECT * FROM plan_previews WHERE id=$1 AND user_id=$2 AND team_id=$3 AND applied_at IS NULL AND expires_at>now() FOR UPDATE',[req.params.id,req.auth.user_id,req.auth.team_id])).rows[0];if(!preview)throw Object.assign(new Error('Prévia expirada ou já aplicada.'),{status:409});if(!preview.feasible)throw Object.assign(new Error('O plano não cabe antes da data-meta. Ajuste disponibilidade ou data-meta.'),{status:409});await c.query("UPDATE schedules SET superseded_at=now() WHERE user_id=$1 AND superseded_at IS NULL",[req.auth.user_id]);const schedule=(await c.query("INSERT INTO schedules(user_id,goal_id,revision,reason) VALUES($1,$2,COALESCE((SELECT max(revision)+1 FROM schedules WHERE user_id=$1),1),'Plano flexível baseado em documentos citáveis') RETURNING *",[req.auth.user_id,preview.goal_id])).rows[0];let created=0;for(const session of preview.payload.sessions.filter(x=>!x.preserved)){const courseId=session.activities.find(x=>x.courseId)?.courseId||null;const study=(await c.query(`INSERT INTO study_sessions(team_id,user_id,course_id,activity_type,planned_minutes,planned_at,schedule_id,status,planned_start,planned_end,priority,locked,fixed_by_user,timezone,sync_identifier,notes) VALUES($1,$2,$3,$4,$5,$6,$7,'planned',$6,$8,$9,false,false,'America/Sao_Paulo',$10,$11) RETURNING *`,[req.auth.team_id,req.auth.user_id,courseId,session.activityType,session.plannedMinutes,session.plannedStart,schedule.id,session.plannedEnd,session.priority,`falcon-session-${session.id}`,session.title])).rows[0];let position=0;for(const activity of session.activities){const stored=(await c.query(`INSERT INTO study_activities(team_id,course_id,activity_type,title,objective,topic,instructions,key_concepts,completion_criteria,deliverable,estimated_minutes,priority,prerequisite_order,document_id,version_id,page_number,section,excerpt,question_category,question_count,query_exercise_id,lab_id,curator_status,source_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) ON CONFLICT(team_id,source_fingerprint) DO UPDATE SET updated_at=now() RETURNING id`,[req.auth.team_id,activity.courseId||null,activity.activityType,activity.title,activity.objective,activity.topic,activity.instructions,JSON.stringify(activity.keyConcepts||[]),activity.completionCriteria,activity.deliverable||null,activity.estimatedMinutes,activity.priority||3,activity.prerequisiteOrder||0,activity.documentId||null,activity.versionId||null,activity.pageNumber||null,activity.section||null,activity.excerpt||null,activity.questionCategory||null,activity.questionCount||null,activity.queryExerciseId||null,activity.labId||null,activity.curatorStatus||'ready',activity.sourceFingerprint])).rows[0];await c.query('INSERT INTO study_session_activities(team_id,session_id,activity_id,position,planned_minutes,split_part) VALUES($1,$2,$3,$4,$5,$6)',[req.auth.team_id,study.id,stored.id,++position,activity.plannedMinutes,activity.splitPart||1]);}await c.query(`INSERT INTO calendar_events(schedule_id,user_id,activity_type,reference_id,title,planned_start,planned_end,study_session_id,priority,estimated_minutes,locked,icon,color_key,sync_identifier) VALUES($1,$2,'study_session',$3,$4,$5,$6,$3,$7,$8,false,$9,$10,$11)`,[schedule.id,req.auth.user_id,study.id,session.title,session.plannedStart,session.plannedEnd,session.priority,session.plannedMinutes,session.activityType==='lab'?'⌘':session.activityType==='quiz'?'?':session.activityType==='query'?'⌁':'◫',session.activityType,`falcon-session-${session.id}`]);created++;}await c.query('UPDATE plan_previews SET applied_at=now() WHERE id=$1',[preview.id]);await audit(c,req,'schedule.flexible_applied','schedule',schedule.id,{sessions:created,previewId:preview.id});return{schedule,created};},scope(req));res.status(201).json(result);}));

  app.get('/api/v2/calendar',requireAuth,route(async(req,res)=>{const b=parse(z.object({from:z.string().date(),to:z.string().date(),scope:z.enum(['mine','team']).default('mine'),status:z.string().max(30).default('')}),req.query);if(b.scope==='team'&&!['manager','admin_reviewer'].includes(req.auth.role))return res.status(403).json({error:'Calendário da equipe exige perfil gestor.'});const {rows}=await transaction(c=>c.query(`SELECT ss.id,ss.user_id,u.display_name,ss.status,ss.planned_start,ss.planned_end,ss.planned_minutes,ss.actual_minutes,ss.priority,ss.locked,ss.notes title,ss.activity_type,ss.sync_identifier,
    COALESCE(json_agg(json_build_object('id',sa.id,'title',sa.title,'type',sa.activity_type,'objective',sa.objective,'topic',sa.topic,'instructions',sa.instructions,'keyConcepts',sa.key_concepts,'completionCriteria',sa.completion_criteria,'deliverable',sa.deliverable,'minutes',ssa.planned_minutes,'status',ssa.status,'documentId',sa.document_id,'versionId',sa.version_id,'page',sa.page_number,'section',sa.section,'excerpt',sa.excerpt,'questionCategory',sa.question_category,'questionCount',sa.question_count,'queryExerciseId',sa.query_exercise_id,'labId',sa.lab_id,'curatorStatus',sa.curator_status) ORDER BY ssa.position) FILTER(WHERE sa.id IS NOT NULL),'[]') activities
    FROM study_sessions ss JOIN users u ON u.id=ss.user_id LEFT JOIN schedules sch ON sch.id=ss.schedule_id LEFT JOIN study_session_activities ssa ON ssa.session_id=ss.id LEFT JOIN study_activities sa ON sa.id=ssa.activity_id
    WHERE ss.team_id=$1 AND ($2='team' OR ss.user_id=$3) AND ss.planned_start >= $4::date AND ss.planned_start < $5::date+1 AND ($6='' OR ss.status=$6) AND (sch.superseded_at IS NULL OR ss.locked OR ss.status='completed')
    GROUP BY ss.id,u.display_name ORDER BY ss.planned_start`,[req.auth.team_id,b.scope,req.auth.user_id,b.from,b.to,b.status]),scope(req));res.json(rows);}));

  app.patch('/api/v2/calendar/sessions/:id',requireAuth,requireCsrf,route(async(req,res)=>{const b=parse(z.object({plannedStart:z.string().datetime().optional(),plannedEnd:z.string().datetime().optional(),locked:z.boolean().optional(),status:z.enum(['planned','in_progress','completed','missed','cancelled']).optional()}),req.body);const row=await transaction(async c=>{const before=(await c.query('SELECT * FROM study_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.auth.user_id])).rows[0];if(!before)throw Object.assign(new Error('Sessão não encontrada.'),{status:404});if(before.locked&&(b.plannedStart||b.plannedEnd)&&b.locked!==false)throw Object.assign(new Error('Desbloqueie a sessão antes de movê-la.'),{status:409});const after=(await c.query(`UPDATE study_sessions SET planned_start=COALESCE($1,planned_start),planned_end=COALESCE($2,planned_end),planned_at=COALESCE($1,planned_at),locked=COALESCE($3,locked),fixed_by_user=CASE WHEN $1 IS NOT NULL OR $2 IS NOT NULL THEN true ELSE fixed_by_user END,status=COALESCE($4,status),started_at=CASE WHEN $4='in_progress' THEN COALESCE(started_at,now()) ELSE started_at END,completed_at=CASE WHEN $4='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END WHERE id=$5 RETURNING *`,[b.plannedStart||null,b.plannedEnd||null,b.locked,b.status||null,before.id])).rows[0];await c.query('UPDATE calendar_events SET planned_start=$1,planned_end=$2,locked=$3,status=$4 WHERE study_session_id=$5',[after.planned_start,after.planned_end,after.locked,after.status,after.id]);await c.query('INSERT INTO calendar_change_history(team_id,user_id,session_id,action,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[req.auth.team_id,req.auth.user_id,after.id,b.status==='completed'?'completed':'updated',JSON.stringify(before),JSON.stringify(after),'Alteração explícita do usuário']);if(b.status==='completed'){await ensurePointRules(c,req.auth.team_id);const rule=(await c.query("SELECT * FROM point_rules WHERE team_id=$1 AND code='activity_completed'",[req.auth.team_id])).rows[0];await c.query('INSERT INTO point_events(team_id,user_id,rule_id,source_type,source_id,points,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(team_id,idempotency_key) DO NOTHING',[req.auth.team_id,req.auth.user_id,rule.id,'study_session',after.id,rule.points,`session:${after.id}:completed`]);}await audit(c,req,'calendar.session_updated','study_session',after.id,{status:after.status,locked:after.locked});return after;},scope(req));res.json(row);}));

  app.get('/api/v2/calendar/export.ics',requireAuth,route(async(req,res)=>{const {rows}=await transaction(c=>c.query("SELECT * FROM study_sessions WHERE user_id=$1 AND status<>'cancelled' AND planned_start IS NOT NULL ORDER BY planned_start",[req.auth.user_id]),scope(req));res.type('text/calendar').attachment('agenda-falcon-admin.ics').send(toStableIcs(rows));}));

  app.post('/api/v2/simulations',requireAuth,requireCsrf,route(async(req,res)=>{const b=parse(z.object({mode:z.enum(['quick','domain','custom','adaptive','error_review','full']).default('quick'),count:z.number().int().min(1).max(60).default(10),durationMinutes:z.number().int().min(5).max(90).default(20),categories:z.array(z.string()).default([]),difficulties:z.array(z.string()).default([]),preview:z.boolean().default(false)}),req.body);if(b.preview&&req.auth.role!=='admin_reviewer')return res.status(403).json({error:'Modo de prévia é exclusivo do Revisor.'});if(b.mode==='full'){b.count=60;b.durationMinutes=90;}const seed=randomToken(12);const result=await transaction(async c=>{const allowed=b.preview?['published','review']:['published'];const candidates=(await c.query(`SELECT q.id,q.version,q.category,q.difficulty FROM questions q WHERE q.team_id=$1 AND q.status=ANY($2::text[]) AND EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id AND qs.validation_status='validated_content') AND ($3::text[]='{}' OR q.category=ANY($3)) AND ($4::text[]='{}' OR q.difficulty=ANY($4)) ORDER BY EXISTS(SELECT 1 FROM attempts a WHERE a.user_id=$5 AND a.question_id=q.id AND a.created_at>now()-interval '14 days'),q.category,q.difficulty`,[req.auth.team_id,allowed,b.categories,b.difficulties,req.auth.user_id])).rows;const selected=balancedSelection(candidates,b.count,seed);if(selected.length<b.count)throw Object.assign(new Error(`Disponíveis ${selected.length}; ajuste filtros ou use uma quantidade menor.`),{status:409,available:selected.length});const sim=(await c.query(`INSERT INTO simulations(team_id,user_id,mode,seed,question_count,duration_minutes,category_filter,difficulty_filter,deadline_at,last_autosave_at,preview_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+($6*interval '1 minute'),now(),$9) RETURNING *`,[req.auth.team_id,req.auth.user_id,b.mode,seed,b.count,b.durationMinutes,JSON.stringify(b.categories),JSON.stringify(b.difficulties),b.preview])).rows[0];for(const [i,q] of selected.entries())await c.query('INSERT INTO simulation_questions(simulation_id,question_id,question_version,position) VALUES($1,$2,$3,$4)',[sim.id,q.id,q.version,i+1]);await c.query("INSERT INTO simulation_events(team_id,simulation_id,user_id,event_type,payload) VALUES($1,$2,$3,'started',$4)",[req.auth.team_id,sim.id,req.auth.user_id,JSON.stringify({mode:b.mode,count:b.count,seed})]);return sim;},scope(req));res.status(201).json(result);}));

  app.get('/api/v2/simulations/active',requireAuth,route(async(req,res)=>{
    const result=await transaction(async c=>{
      const sim=(await c.query("SELECT *,greatest(0,extract(epoch FROM(deadline_at-now())))::int remaining_seconds FROM simulations WHERE user_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 1",[req.auth.user_id])).rows[0];
      if(!sim)return null;
      const questions=(await c.query(`SELECT sq.position,q.id,q.version,q.category,q.subcategory,q.difficulty,q.format,q.correct_count,COALESCE(qt.prompt,q.prompt) prompt,COALESCE(qt.options,q.options) options,a.answer,a.confidence,a.elapsed_seconds,a.marked_for_review
        FROM simulation_questions sq JOIN questions q ON q.id=sq.question_id
        LEFT JOIN question_translations qt ON qt.question_id=q.id AND qt.language=$2 AND qt.translation_status='reviewed'
        LEFT JOIN answers a ON a.simulation_id=sq.simulation_id AND a.question_id=q.id
        WHERE sq.simulation_id=$1 ORDER BY sq.position`,[sim.id,sim.language||'pt-BR'])).rows;
      return{...sim,questions};
    },scope(req));
    res.json(result);
  }));

  app.get('/api/v2/simulations/:id',requireAuth,route(async(req,res)=>{
    const result=await transaction(async c=>{
      const sim=(await c.query('SELECT *,greatest(0,extract(epoch FROM(deadline_at-now())))::int remaining_seconds FROM simulations WHERE id=$1 AND user_id=$2',[req.params.id,req.auth.user_id])).rows[0];
      if(!sim)return null;
      const questions=(await c.query(`SELECT sq.position,q.id,q.version,q.category,q.subcategory,q.difficulty,q.format,q.correct_count,COALESCE(qt.prompt,q.prompt) prompt,COALESCE(qt.options,q.options) options,a.answer,a.confidence,a.elapsed_seconds,a.marked_for_review
        FROM simulation_questions sq JOIN questions q ON q.id=sq.question_id
        LEFT JOIN question_translations qt ON qt.question_id=q.id AND qt.language=$2 AND qt.translation_status='reviewed'
        LEFT JOIN answers a ON a.simulation_id=sq.simulation_id AND a.question_id=q.id
        WHERE sq.simulation_id=$1 ORDER BY sq.position`,[sim.id,sim.language||'pt-BR'])).rows;
      return{...sim,questions};
    },scope(req));
    if(!result)return res.status(404).json({error:'Tentativa não encontrada.'});
    res.json(result);
  }));

  app.put('/api/v2/simulations/:id/autosave',requireAuth,requireCsrf,route(async(req,res)=>{const b=parse(z.object({questionId:z.string().uuid(),answer:z.any(),position:z.number().int().min(1),elapsedSeconds:z.number().int().min(0).max(7200).default(0),confidence:z.number().int().min(1).max(5).optional(),marked:z.boolean().default(false)}),req.body);const result=await transaction(async c=>{const sim=(await c.query("SELECT * FROM simulations WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE",[req.params.id,req.auth.user_id])).rows[0];if(!sim)throw Object.assign(new Error('Tentativa finalizada ou inexistente.'),{status:409});if(sim.deadline_at&&new Date(sim.deadline_at)<=new Date())throw Object.assign(new Error('O tempo do servidor terminou. Entregue a tentativa.'),{status:409});const q=(await c.query('SELECT q.* FROM simulation_questions sq JOIN questions q ON q.id=sq.question_id WHERE sq.simulation_id=$1 AND q.id=$2',[sim.id,b.questionId])).rows[0];if(!q)throw Object.assign(new Error('Questão fora desta tentativa.'),{status:400});const correct=JSON.stringify(q.correct_answer)===JSON.stringify(b.answer);await c.query('INSERT INTO answers(simulation_id,question_id,user_id,answer,correct,elapsed_seconds,confidence,marked_for_review) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(simulation_id,question_id) DO UPDATE SET answer=EXCLUDED.answer,correct=EXCLUDED.correct,elapsed_seconds=EXCLUDED.elapsed_seconds,confidence=EXCLUDED.confidence,marked_for_review=EXCLUDED.marked_for_review,answered_at=now()',[sim.id,q.id,req.auth.user_id,JSON.stringify(b.answer),correct,b.elapsedSeconds,b.confidence||null,b.marked]);await c.query('UPDATE simulations SET current_position=$1,last_autosave_at=now() WHERE id=$2',[b.position,sim.id]);await c.query("INSERT INTO simulation_events(team_id,simulation_id,user_id,event_type,position,payload) VALUES($1,$2,$3,'autosave',$4,$5)",[req.auth.team_id,sim.id,req.auth.user_id,b.position,JSON.stringify({marked:b.marked})]);return{saved:true,correct:sim.mode==='quick'||sim.preview_mode?correct:undefined,explanation:sim.mode==='quick'||sim.preview_mode?q.explanation:undefined};},scope(req));res.json(result);}));

  app.post('/api/v2/simulations/:id/submit',requireAuth,requireCsrf,route(async(req,res)=>{const result=await transaction(async c=>{const sim=(await c.query('SELECT * FROM simulations WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.auth.user_id])).rows[0];if(!sim)throw Object.assign(new Error('Tentativa não encontrada.'),{status:404});const counts=(await c.query('SELECT count(*) total,count(*) FILTER(WHERE correct) correct,round(avg(elapsed_seconds),1) avg_seconds FROM answers WHERE simulation_id=$1',[sim.id])).rows[0];const score=Number(counts.total)?Number(counts.correct)/Number(counts.total)*100:0;if(sim.status!=='finished')await c.query("UPDATE simulations SET status='finished',finished_at=now(),submitted_at=now(),score=$1 WHERE id=$2",[score,sim.id]);const domains=(await c.query('SELECT q.category,count(*) total,count(*) FILTER(WHERE a.correct) correct,round(100.0*count(*) FILTER(WHERE a.correct)/nullif(count(*),0),1) score FROM answers a JOIN questions q ON q.id=a.question_id WHERE a.simulation_id=$1 GROUP BY q.category ORDER BY q.category',[sim.id])).rows;await ensurePointRules(c,req.auth.team_id);const rule=(await c.query("SELECT * FROM point_rules WHERE team_id=$1 AND code='simulation_finished'",[req.auth.team_id])).rows[0];await c.query('INSERT INTO point_events(team_id,user_id,rule_id,source_type,source_id,points,idempotency_key,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(team_id,idempotency_key) DO NOTHING',[req.auth.team_id,req.auth.user_id,rule.id,'simulation',sim.id,rule.points,`simulation:${sim.id}:finished`,JSON.stringify({score})]);await audit(c,req,'simulation.submitted','simulation',sim.id,{score:Number(score.toFixed(1)),answered:Number(counts.total)});return{total:Number(counts.total),correct:Number(counts.correct),score:Number(score.toFixed(1)),avgSeconds:Number(counts.avg_seconds||0),domains};},scope(req));res.json(result);}));

  app.get('/api/v2/ranking',requireAuth,route(async(req,res)=>{const period=String(req.query.period||'weekly');const interval=period==='monthly'?'30 days':period==='overall'?'100 years':'7 days';const result=await transaction(async c=>{await ensurePointRules(c,req.auth.team_id);const rows=(await c.query(`SELECT u.id,u.display_name,u.profile_photo_key IS NOT NULL has_photo,r.code role,COALESCE(sum(pe.points) FILTER(WHERE pe.created_at>=now()-$2::interval),0)::int xp,count(DISTINCT pe.id) FILTER(WHERE pe.created_at>=now()-$2::interval) events FROM memberships m JOIN users u ON u.id=m.user_id AND u.active JOIN roles r ON r.id=m.role_id LEFT JOIN point_events pe ON pe.team_id=m.team_id AND pe.user_id=u.id WHERE m.team_id=$1 GROUP BY u.id,u.display_name,u.profile_photo_key,r.code,u.created_at ORDER BY xp DESC,events DESC,u.created_at`,[req.auth.team_id,interval])).rows;return{enabled:true,period,rows:rows.map((x,i)=>({...x,position:i+1,isMe:x.id===req.auth.user_id}))};},scope(req));res.json(result);}));

  app.get('/api/v2/dashboard',requireAuth,route(async(req,res)=>{const result=await transaction(c=>Promise.all([c.query("SELECT count(*) FILTER(WHERE status='published') published,count(*) FILTER(WHERE status='review') review FROM questions WHERE team_id=$1",[req.auth.team_id]),c.query("SELECT count(*) sessions,coalesce(sum(planned_minutes),0) minutes FROM study_sessions ss LEFT JOIN schedules s ON s.id=ss.schedule_id WHERE ss.user_id=$1 AND ss.planned_start>=date_trunc('week',now()) AND ss.planned_start<date_trunc('week',now())+interval '7 days' AND (s.superseded_at IS NULL OR ss.locked)",[req.auth.user_id]),c.query("SELECT count(*) completed FROM lab_runs WHERE user_id=$1 AND status='completed'",[req.auth.user_id]),c.query("SELECT coalesce(sum(points),0)::int xp FROM point_events WHERE team_id=$1 AND user_id=$2",[req.auth.team_id,req.auth.user_id]),c.query("SELECT ss.id,ss.notes title,ss.planned_start,ss.planned_end,ss.planned_minutes,ss.activity_type,ss.status FROM study_sessions ss LEFT JOIN schedules s ON s.id=ss.schedule_id WHERE ss.user_id=$1 AND ss.planned_start>=now() AND (s.superseded_at IS NULL OR ss.locked) ORDER BY ss.planned_start LIMIT 5",[req.auth.user_id])]),scope(req));res.json({questions:result[0].rows[0],week:result[1].rows[0],labs:result[2].rows[0],ranking:result[3].rows[0],nextSessions:result[4].rows});}));
}
