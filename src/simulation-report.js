const timeZone='America/Sao_Paulo';

export function simulationWeek(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
  const localDate=new Date(Date.UTC(parts.year,parts.month-1,parts.day));
  localDate.setUTCDate(localDate.getUTCDate()-((localDate.getUTCDay()+6)%7));
  const weekStart=localDate.toISOString().slice(0,10);
  localDate.setUTCDate(localDate.getUTCDate()+7);
  return{weekStart,nextWeekStart:localDate.toISOString().slice(0,10),timeZone};
}

const indexes=value=>Array.isArray(value)?value.map(Number):value===null||value===undefined?[]:[Number(value)];
const percent=(correct,total)=>total?Math.round(correct/total*1000)/10:0;

export function buildSimulationReport(simulation,questions,certification){
  const byDomain=new Map();
  const details=questions.map(row=>{
    const answered=row.answer!==null&&row.answer!==undefined;
    const correct=answered&&row.correct===true;
    const domain=row.category||'Sem domínio';
    const stat=byDomain.get(domain)||{domain,total:0,answered:0,correct:0,incorrect:0,unanswered:0};
    stat.total++;
    if(!answered)stat.unanswered++;
    else if(correct){stat.answered++;stat.correct++;}
    else {stat.answered++;stat.incorrect++;}
    byDomain.set(domain,stat);
    return{
      position:Number(row.position),questionId:row.id,domain,difficulty:row.difficulty,
      prompt:row.prompt,options:row.options,answer:answered?row.answer:null,
      correctAnswer:row.correct_answer,correct,answered,
      explanation:row.explanation||'',source:row.source||null
    };
  });
  const domains=[...byDomain.values()].map(stat=>({...stat,score:percent(stat.correct,stat.total)}))
    .sort((a,b)=>a.domain.localeCompare(b.domain,'pt-BR'));
  const strengths=domains.filter(domain=>domain.total>=2&&domain.score>=80)
    .sort((a,b)=>b.score-a.score||b.total-a.total);
  const focus=domains.filter(domain=>domain.score<70||domain.unanswered>0)
    .sort((a,b)=>a.score-b.score||b.incorrect-a.incorrect);
  const missed=details.filter(question=>!question.correct);
  const correct=details.length-missed.length;
  const answered=details.filter(question=>question.answered).length;
  return{
    version:1,simulationId:simulation.id,certification:certification?{
      code:certification.code,title:certification.title
    }:null,mode:simulation.mode,language:simulation.language||'pt-BR',
    startedAt:simulation.started_at,finishedAt:simulation.finished_at||new Date().toISOString(),
    total:details.length,answered,correct,incorrect:answered-correct,unanswered:details.length-answered,
    score:percent(correct,details.length),avgSeconds:answered?Math.round(details.filter(q=>q.answered).reduce((sum,q)=>sum+Number(questions.find(row=>Number(row.position)===q.position)?.elapsed_seconds||0),0)/answered):0,
    domains,strengths,focus,missed,
    nextSteps:[
      ...focus.slice(0,3).map(domain=>`Priorize ${domain.domain}: ${domain.correct}/${domain.total} acertos; revise as questões e fontes associadas.`),
      ...(missed.length?['Reveja cada erro e questão sem resposta antes de iniciar outro simulado completo.']:['Mantenha a revisão espaçada dos domínios estudados.'])
    ]
  };
}

export function formatAnswer(answer,options=[]){
  const selected=indexes(answer).filter(index=>Number.isInteger(index)&&index>=0&&index<options.length);
  return selected.length?selected.map(index=>`${String.fromCharCode(65+index)}. ${options[index]}`).join(' · '):'Não respondida';
}
