import type { ScheduledEvent } from './model';

export const BEIJING_ZONE = 'Asia/Shanghai';
const zones: Array<[RegExp,string]> = [
  [/^(?:PT|PST|PDT|Pacific(?: Standard| Daylight)?(?: Time)?)$/i,'America/Los_Angeles'],
  [/^(?:ET|EST|EDT|Eastern(?: Standard| Daylight)?(?: Time)?)$/i,'America/New_York'],
  [/^(?:MT|MST|MDT|Mountain(?: Standard| Daylight)?(?: Time)?)$/i,'America/Denver'],
  [/^(?:CT|CDT|Central(?: Standard| Daylight)?(?: Time)?)$/i,'America/Chicago'],
  [/^(?:北京时间|北京時間|中国标准时间|中國標準時間|China Standard Time|CST \(China\))$/i,BEIJING_ZONE],
  [/^(?:HKT|Hong Kong Time|香港时间|香港時間)$/i,'Asia/Hong_Kong'],
  [/^(?:UTC|GMT)$/i,'UTC'],
];
export function scheduleTimezone(value: string | null) {
  if (!value) return null;
  // An explicitly supplied but ambiguous label is not a missing time zone.
  return zones.find(([pattern]) => pattern.test(value.trim()))?.[1] ?? null;
}
export function localParts(ms: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
  const get = (key: string) => parts.find(p=>p.type===key)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
/** Reject nonexistent and ambiguous DST times rather than choosing an offset. */
export function scheduleInstant(day: string, time: string, zone: string, abbreviation?:string|null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10)!==day || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Invalid local schedule');
  const desired = `${day}T${time}`, wall = Date.parse(`${desired}:00Z`);
  const offsets = new Set<number>();
  for (const delta of [-36,-12,0,12,36]) {
    const point = wall + delta * 3600000;
    offsets.add(Date.parse(`${localParts(point,zone)}:00Z`) - point);
  }
  const matches = [...offsets].map(offset=>wall-offset).filter(point=>localParts(point,zone)===desired);
  if (matches.length !== 1) throw new Error('Ambiguous or nonexistent source timezone time');
  const instant=new Date(matches[0]).toISOString();
  if(abbreviation&&/^(PST|PDT|EST|EDT|MST|MDT|CDT)$/i.test(abbreviation)){
    const actual=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'short'}).formatToParts(new Date(instant)).find(part=>part.type==='timeZoneName')?.value;
    if(actual!==abbreviation.toUpperCase())throw new Error('Timezone abbreviation conflicts with event date');
  }
  return instant;
}

export type CalendarTiming = Pick<ScheduledEvent,'scheduled_date'|'scheduled_at'> & Partial<Pick<ScheduledEvent,'companyId'|'companyCountry'|'source_timezone'|'timezone_text'|'local_time'|'timeEvidence'>>;
export const isChinaCalendarCompany = (event: Pick<CalendarTiming,'companyId'|'companyCountry'>) => event.companyCountry === 'CN' || /^(XSHG|XSHE):/.test(event.companyId ?? '');
// Recognizing a zone reference is broader than knowing how to convert it.
// Unsupported explicit zones must remain unconfirmed, never become Beijing defaults.
const zoneEvidencePatterns = [
  /\b(?:[PEMC](?:S|D)?T|UTC|GMT|HKT|Pacific|Eastern|Mountain|Central|Hong Kong|JST|KST|IST|BST|CET|CEST|EET|EEST|AEST|AEDT|NZST|NZDT)\b/i,
  /\b(?:standard|daylight|summer|mean)\s+time\b|\btime\s*zone\b|\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/i,
  /(?:^|[\s(])[+-](?:0\d|1\d|2[0-3]):?[0-5]\d(?=$|[\s)])/,
  /时区|時區|北京时间|北京時間|香港时间|香港時間|(?:标准|標準|夏令|冬令|东部|東部|西部|中部|世界|协调|協調|美国|美國|日本|韩国|韓國|印度|英国|英國|欧洲|歐洲|澳洲|悉尼|东京|東京|新加坡)[\p{Script=Han}]{0,8}(?:时间|時間)/u,
];
const hasZoneEvidence=(text='')=>zoneEvidencePatterns.some(pattern=>pattern.test(text));
export function sourceScheduleZone(label: string | null | undefined, company: Pick<CalendarTiming,'companyId'|'companyCountry'>, evidence='') {
  // A missed extraction field must not turn an explicit source zone into a default.
  return scheduleTimezone(label ?? null) ?? (!label?.trim() && !hasZoneEvidence(evidence) && isChinaCalendarCompany(company) ? BEIJING_ZONE : null);
}
export const assumesBeijing = (event: CalendarTiming) => isChinaCalendarCompany(event) && !event.timezone_text?.trim() && !hasZoneEvidence(event.timeEvidence) && (!event.source_timezone || event.source_timezone === BEIJING_ZONE);

/** Older stored local schedules also use the default, without a database backfill. */
export function calendarInstant(event: CalendarTiming) {
  if (event.scheduled_at) return Number.isFinite(Date.parse(event.scheduled_at)) ? event.scheduled_at : null;
  const zone = event.source_timezone ?? sourceScheduleZone(event.timezone_text,event,event.timeEvidence);
  if (!event.local_time || !zone) return null;
  try { return scheduleInstant(event.scheduled_date,event.local_time,zone,event.timezone_text); } catch { return null; }
}
