import type { ScheduledEvent } from './model';
import { calendarInstant } from './time';

function sameAnnouncement(a:ScheduledEvent,b:ScheduledEvent) {
  return (a.sourceEventIds??[]).some(id=>b.sourceEventIds?.includes(id)) || Boolean(a.url && a.url===b.url && a.announcement_date && a.announcement_date===b.announcement_date);
}
function sameTime(a:ScheduledEvent,b:ScheduledEvent) {
  const first=calendarInstant(a),second=calendarInstant(b);
  if(first||second)return Boolean(first&&second&&Date.parse(first)===Date.parse(second));
  if(a.local_time||b.local_time)return Boolean(a.local_time&&a.local_time===b.local_time&&a.source_timezone===b.source_timezone&&a.timezone_text===b.timezone_text);
  // A date alone cannot establish that two calls start together.
  return a.eventKind==='earnings_release'&&a.timeSlot===b.timeSlot&&(a.timeSlot!=='unspecified'||Boolean(a.dateEvidence&&a.dateEvidence===b.dateEvidence));
}
const instant=(value:string|null|undefined)=>{const ms=Date.parse(value??'');return Number.isFinite(ms)?ms:0;};
const newestFirst=(a:ScheduledEvent,b:ScheduledEvent)=>(b.announcement_date??'').localeCompare(a.announcement_date??'')
  ||instant(b.published_at)-instant(a.published_at)||instant(b.processed_at)-instant(a.processed_at)
  ||Number(b.status==='cancelled')-Number(a.status==='cancelled')
  ||Number(b.status==='rescheduled')-Number(a.status==='rescheduled')||a.id.localeCompare(b.id);

/** Q4 and full-year labels can describe the same announced results and call.
 * Require a validated Q4 anchor, shared provenance, issuer, date and fiscal year. Distinct
 * quarters, half-years, announcements and call times remain independent.
 */
export function reconcileCalendarSchedules<T extends ScheduledEvent>(items:readonly T[]) {
  const quarters=new Map<string,T[]>();
  const quarterKey=(item:T,year:string)=>JSON.stringify([item.companyId,item.scheduled_date,year]);
  for(const item of items){
    const year=/^FY(20\d{2})-Q4$/.exec(item.fiscalPeriod)?.[1];
    if(year){const key=quarterKey(item,year);quarters.set(key,[...(quarters.get(key)??[]),item]);}
  }
  type Cluster={period:string;members:T[]};
  const buckets=new Map<string,Cluster[]>(),clusters:Cluster[]=[];
  for(const item of items){
    const year=/^FY(20\d{2})$/.exec(item.fiscalPeriod)?.[1];
    const anchors=year?(quarters.get(quarterKey(item,year))??[]).filter(quarter=>sameAnnouncement(item,quarter)):[];
    const sameKind=anchors.filter(quarter=>quarter.eventKind===item.eventKind);
    const alias=anchors.some(quarter=>quarter.confirmation==='official')&&(!sameKind.length||sameKind.some(quarter=>sameTime(item,quarter)));
    const period=alias?`FY${year}-Q4`:item.fiscalPeriod;
    const key=JSON.stringify([item.companyId,item.scheduled_date,period,item.eventKind]);
    const bucket=buckets.get(key)??[];
    const cluster=bucket.find(group=>group.members.every(other=>sameAnnouncement(item,other)&&sameTime(item,other)));
    if(cluster)cluster.members.push(item);
    else{const next={period,members:[item]};bucket.push(next);buckets.set(key,bucket);clusters.push(next);}
  }
  const byId=new Map<string,T>();
  const schedules=clusters.map(({period,members})=>{
    const preferred=[...members].sort(newestFirst)[0];
    const canonical=members.filter(item=>item.fiscalPeriod===period).sort((a,b)=>a.id.localeCompare(b.id))[0]??preferred;
    const periods=[...new Set([period,...members.flatMap(item=>item.fiscalPeriods??[item.fiscalPeriod])])];
    const ids=[...new Set(members.flatMap(item=>[item.id,...(item.equivalentScheduleIds??[])]))];
    const warnings=[...new Set(members.flatMap(item=>item.validationWarnings??[]))];
    const result=members.length===1&&period===preferred.fiscalPeriod?preferred:{...preferred,id:canonical.id,fiscalPeriod:period,
      ...(periods.length>1?{fiscalPeriods:periods}:{}),...(ids.length>1?{equivalentScheduleIds:ids}:{}),
      sourceEventIds:[...new Set(members.flatMap(item=>item.sourceEventIds??[]))],
      ...(warnings.length?{validationWarnings:warnings,confirmation:'extracted' as const}:{})} as T;
    for(const id of ids)byId.set(id,result);
    byId.set(result.id,result);
    return result;
  });
  return {schedules,byId};
}
