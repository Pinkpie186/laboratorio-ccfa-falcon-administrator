const REVIEW_DAYS = [1, 3, 7, 14, 30];
export function buildAdaptiveSchedule({ targetDate, availability, activities, excludedDates = [], now = new Date() }) {
  const end = new Date(`${targetDate}T23:59:59-03:00`);
  if (!Number.isFinite(end.getTime()) || end <= now) throw new Error('A data-meta deve estar no futuro.');
  const excluded = new Set(excludedDates);
  const slots = [];
  for (let day = new Date(now); day <= end; day.setDate(day.getDate() + 1)) {
    const localDate = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    if (excluded.has(localDate)) continue;
    const rules = availability.filter(x => Number(x.weekday) === day.getDay());
    for (const rule of rules) {
      const [h, m] = String(rule.startTime).split(':').map(Number);
      const start = new Date(day); start.setHours(h, m, 0, 0);
      const duration = Number(rule.sessionMinutes || 45);
      if (start > now) slots.push({ start, end: new Date(start.getTime() + duration * 60000), duration });
    }
  }
  const ordered = [...activities].sort((a,b) => (a.prerequisiteOrder - b.prerequisiteOrder) || (a.mastery - b.mastery));
  const events = [];
  let index = 0;
  for (const activity of ordered) {
    let remaining = activity.minutes;
    while (remaining > 0 && index < slots.length) {
      const slot = slots[index++]; const used = Math.min(remaining, slot.duration);
      events.push({ title: activity.title, activityType: activity.type, referenceId: activity.id, plannedStart: slot.start, plannedEnd: new Date(slot.start.getTime() + used * 60000) });
      remaining -= used;
    }
    if (remaining > 0) throw new Error('Disponibilidade insuficiente até a data-meta.');
  }
  return events;
}
export const reviewDates = (completedAt = new Date()) => REVIEW_DAYS.map(days => { const d = new Date(completedAt); d.setDate(d.getDate() + days); return d; });
export function toIcs(events, timezone = 'America/Sao_Paulo') {
  const stamp = date => new Date(date).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const escape = text => String(text).replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n');
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Falcon Admin Lab//PT-BR','CALSCALE:GREGORIAN',...events.flatMap(e => [
    'BEGIN:VEVENT',`UID:${e.id || crypto.randomUUID()}@falcon-admin.local`,`DTSTAMP:${stamp(new Date())}`,
    `DTSTART;TZID=${timezone}:${stamp(e.plannedStart).replace(/Z$/,'')}`,`DTEND;TZID=${timezone}:${stamp(e.plannedEnd).replace(/Z$/,'')}`,
    `SUMMARY:${escape(e.title)}`,'DESCRIPTION:Atividade interna de estudo. Nenhum dado sensível do tenant.','END:VEVENT'
  ]),'END:VCALENDAR'].join('\r\n');
}
