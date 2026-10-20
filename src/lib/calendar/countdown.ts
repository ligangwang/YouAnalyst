import { CALENDAR_ZONE } from './display';
import { BEIJING_ZONE, calendarInstant, localParts, sourceScheduleZone, type CalendarTiming } from './time';
import type { CalendarStatus } from './model';

type Countdown = {kind:'exact';seconds:number} | {kind:'date';days:number;zone:string} | {kind:'reached'} | {kind:'unconfirmed'};
export function calendarCountdown(event: CalendarTiming & {status:CalendarStatus}, now:number): Countdown | null {
  if(event.status==='cancelled'||!Number.isFinite(now))return null;
  const instant=calendarInstant(event);
  if(instant){const seconds=Math.ceil((Date.parse(instant)-now)/1000);return seconds>0?{kind:'exact',seconds}:{kind:'reached'};}
  if(event.local_time)return {kind:'unconfirmed'};
  const zone=event.source_timezone??sourceScheduleZone(event.timezone_text,event,event.timeEvidence)??CALENDAR_ZONE;
  const today=localParts(now,zone).slice(0,10);
  const days=Math.round((Date.parse(event.scheduled_date)-Date.parse(today))/86400000);
  return Number.isFinite(days)?{kind:'date',days,zone}:null;
}
export function countdownLabel(value: Countdown | null, chinese=false) {
  if(!value)return null;
  if(value.kind==='reached')return chinese?'已到公告时间':'Scheduled time reached';
  if(value.kind==='unconfirmed')return chinese?'倒计时待确认（时区或时刻未确认）':'Countdown pending time/time zone confirmation';
  if(value.kind==='date'){
    const day=value.days>0?(chinese?`${value.days}天后`:`In ${value.days} day${value.days===1?'':'s'}`):value.days===0?(chinese?'今天':'Today'):(chinese?'公告日期已过':'Scheduled date passed');
    const zone=value.zone===BEIJING_ZONE?(chinese?'（按北京时间日期）':' (Beijing date)'):'';
    return `${day} · ${chinese?'时刻未公布':'time TBD'}${zone}`;
  }
  const days=Math.floor(value.seconds/86400),hours=Math.floor(value.seconds%86400/3600),minutes=Math.floor(value.seconds%3600/60),seconds=value.seconds%60;
  const clock=[hours,minutes,seconds].map(part=>String(part).padStart(2,'0')).join(':');
  return chinese?`倒计时 ${days?`${days}天 `:''}${clock}`:`Starts in ${days?`${days}d `:''}${clock}`;
}
