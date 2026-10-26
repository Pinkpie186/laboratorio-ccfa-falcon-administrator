import crypto from 'node:crypto';

export const TIMEZONE='America/Sao_Paulo';
const OFFSET='-03:00';
const pad=n=>String(n).padStart(2,'0');
const minutes=(time='00:00')=>{const [h,m]=String(time).slice(0,5).split(':').map(Number);return h*60+m;};
const hhmm=value=>`${pad(Math.floor(value/60))}:${pad(value%60)}`;
const isoLocal=(date,time)=>new Date(`${date}T${String(time).slice(0,5)}:00${OFFSET}`);
const dateKey=date=>new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const nextDate=value=>{const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const weekday=value=>new Date(`${value}T12:00:00${OFFSET}`).getUTCDay();
const weekKey=value=>{const d=new Date(`${value}T12:00:00Z`);const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10);};

function freeIntervals(start,end,locked){
  const result=[];let cursor=start;
  for(const item of [...locked].sort((a,b)=>a.start-b.start)){
    if(item.end<=cursor||item.start>=end)continue;
    if(item.start>cursor)result.push({start:cursor,end:new Date(Math.min(item.start,end))});
    cursor=new Date(Math.max(cursor,item.end));
    if(cursor>=end)break;
  }
  if(cursor<end)result.push({start:cursor,end});
  return result;
}

export function buildFlexiblePlan({targetDate,windows,activities,excludedDates=[],settings={},lockedSessions=[],now=new Date()}){
  const target=new Date(`${targetDate}T23:59:59${OFFSET}`);
  if(!Number.isFinite(target.getTime())||target<=now)throw new Error('A data-meta deve estar no futuro.');
  const cfg={minSessionMinutes:20,maxSessionMinutes:90,maxDailyMinutes:180,maxWeeklyMinutes:600,gapMinutes:15,intensity:'balanced',weekendsEnabled:false,...settings};
  if(cfg.minSessionMinutes>cfg.maxSessionMinutes)throw new Error('A duração mínima não pode superar a máxima.');
  const excluded=new Set(excludedDates);
  const locked=lockedSessions.map(x=>({...x,start:new Date(x.plannedStart||x.start),end:new Date(x.plannedEnd||x.end)}));
  const slots=[];const dailyUsed=new Map(),weeklyUsed=new Map();
  for(let day=dateKey(now);day<=targetDate;day=nextDate(day)){
    if(excluded.has(day))continue;
    const wd=weekday(day);if(!cfg.weekendsEnabled&&[0,6].includes(wd))continue;
    const rules=windows.filter(x=>x.active!==false&&Number(x.weekday)===wd).sort((a,b)=>minutes(a.startTime)-minutes(b.startTime));
    for(const rule of rules){
      const start=isoLocal(day,rule.startTime),end=isoLocal(day,rule.endTime);
      if(end<=start||end<=now)continue;
      const actualStart=start<now?new Date(now):start;
      const dayLocked=locked.filter(x=>dateKey(x.start)===day);
      for(const interval of freeIntervals(actualStart,end,dayLocked))slots.push({...interval,date:day,week:weekKey(day),label:rule.label||null});
    }
  }
  const queue=[...activities].filter(x=>Number(x.remainingMinutes??x.estimatedMinutes)>0).sort((a,b)=>(Number(a.prerequisiteOrder||0)-Number(b.prerequisiteOrder||0))||(Number(b.priority||3)-Number(a.priority||3))||(Number(a.mastery||0)-Number(b.mastery||0)));
  const remaining=new Map(queue.map(x=>[x.id,Number(x.remainingMinutes??x.estimatedMinutes)]));
  const sessions=locked.map(x=>({...x,locked:true,preserved:true,activities:x.activities||[]}));
  let slotIndex=0;
  while(queue.some(x=>remaining.get(x.id)>0)&&slotIndex<slots.length){
    const slot=slots[slotIndex++];let cursor=new Date(slot.start);
    const dailyLeft=()=>cfg.maxDailyMinutes-(dailyUsed.get(slot.date)||0);
    const weeklyLeft=()=>cfg.maxWeeklyMinutes-(weeklyUsed.get(slot.week)||0);
    while(cursor<slot.end&&dailyLeft()>=cfg.minSessionMinutes&&weeklyLeft()>=cfg.minSessionMinutes&&queue.some(x=>remaining.get(x.id)>0)){
      const windowLeft=Math.floor((slot.end-cursor)/60000);
      const capacity=Math.min(cfg.maxSessionMinutes,windowLeft,dailyLeft(),weeklyLeft());
      if(capacity<cfg.minSessionMinutes)break;
      const sessionActivities=[];let used=0;
      for(const activity of queue){
        const left=remaining.get(activity.id);if(left<=0||used>=capacity)continue;
        const related=sessionActivities.length===0||sessionActivities.some(x=>x.courseId&&x.courseId===activity.courseId)||left<=20;
        if(!related&&used>=cfg.minSessionMinutes)continue;
        const take=Math.min(left,capacity-used);
        if(take<=0)continue;
        const original=Number(activity.remainingMinutes??activity.estimatedMinutes);
        const prior=original-left;
        sessionActivities.push({...activity,plannedMinutes:take,splitPart:Math.floor(prior/Math.max(1,take))+1});
        remaining.set(activity.id,left-take);used+=take;
      }
      if(!used)break;
      const first=sessionActivities[0],end=new Date(cursor.getTime()+used*60000);
      sessions.push({id:crypto.randomUUID(),title:first.title,activityType:first.activityType,plannedStart:new Date(cursor),plannedEnd:end,plannedMinutes:used,priority:Math.max(...sessionActivities.map(x=>Number(x.priority||3))),locked:false,activities:sessionActivities});
      dailyUsed.set(slot.date,(dailyUsed.get(slot.date)||0)+used);weeklyUsed.set(slot.week,(weeklyUsed.get(slot.week)||0)+used);
      cursor=new Date(end.getTime()+cfg.gapMinutes*60000);
    }
  }
  const unscheduled=queue.filter(x=>remaining.get(x.id)>0).map(x=>({id:x.id,title:x.title,remainingMinutes:remaining.get(x.id)}));
  const requiredMinutes=queue.reduce((n,x)=>n+Number(x.remainingMinutes??x.estimatedMinutes),0);
  const plannedMinutes=sessions.filter(x=>!x.preserved).reduce((n,x)=>n+Number(x.plannedMinutes||0),0);
  const availableMinutes=[...dailyUsed.values()].reduce((a,b)=>a+b,0);
  const conflicts=unscheduled.map(x=>({type:'insufficient_capacity',message:`${x.title}: faltam ${x.remainingMinutes} min.`}));
  return{timezone:TIMEZONE,targetDate,feasible:unscheduled.length===0,requiredMinutes,plannedMinutes,availableMinutes,sessions:sessions.sort((a,b)=>new Date(a.plannedStart)-new Date(b.plannedStart)),unscheduled,conflicts};
}

const esc=value=>String(value??'').replace(/([,;\\])/g,'\\$1').replace(/\r?\n/g,'\\n');
const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
export function toStableIcs(sessions){
  const rows=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Falcon Admin Lab//PT-BR','CALSCALE:GREGORIAN','X-WR-TIMEZONE:America/Sao_Paulo'];
  for(const session of sessions){const uid=session.sync_identifier||session.syncIdentifier||`falcon-${session.id}`;rows.push('BEGIN:VEVENT',`UID:${esc(uid)}@falcon-admin.local`,`DTSTAMP:${stamp(session.created_at||new Date())}`,`DTSTART:${stamp(session.planned_start||session.plannedStart)}`,`DTEND:${stamp(session.planned_end||session.plannedEnd)}`,`SUMMARY:${esc(session.title)}`,`DESCRIPTION:${esc('Sessão de estudo interna. Consulte o Falcon Admin Lab para o roteiro; nenhum dado do tenant é exportado.')}`,'END:VEVENT');}
  return rows.concat('END:VCALENDAR').join('\r\n');
}
