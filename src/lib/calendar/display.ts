import type { CalendarItem } from './model';
export const CALENDAR_ZONE = 'America/New_York';
export const shiftDay = (day:string,delta:number) => new Date(Date.parse(day)+delta*86400000).toISOString().slice(0,10);
export function easternDay(instant:string) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:CALENDAR_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
  const get=(key:string)=>parts.find(part=>part.type===key)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export const eventDay = (event:Pick<CalendarItem,'scheduled_at'|'scheduled_date'>) => event.scheduled_at?easternDay(event.scheduled_at):event.scheduled_date;
export function visibleDays(anchor:string,view:'month'|'week') {
  const day=view==='month'?`${anchor.slice(0,7)}-01`:anchor;
  const weekday=(new Date(`${day}T12:00:00Z`).getUTCDay()+6)%7;
  const first=shiftDay(day,-weekday);
  const length=view==='week'?7:Math.ceil((weekday+new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),0)).getUTCDate())/7)*7;
  return Array.from({length},(_,index)=>shiftDay(first,index));
}
export function calendarTime(event:CalendarItem,chinese=false) {
  if(event.scheduled_at) return new Intl.DateTimeFormat(chinese?'zh-CN':'en-US',{timeZone:CALENDAR_ZONE,hour:'numeric',minute:'2-digit',hour12:!chinese}).format(new Date(event.scheduled_at))+' ET';
  if(event.local_time)return `${event.local_time} ${event.timezone_text??(chinese?'时区未公布':'zone not announced')}`;
  if(event.timeSlot==='before_market')return chinese?'盘前（原公告）':'Before market open (source)';
  if(event.timeSlot==='after_market')return chinese?'盘后（原公告）':'After market close (source)';
  return chinese?'时间未公布':'Time not announced';
}
