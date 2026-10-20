import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarCountdown,countdownLabel} from '../../src/lib/calendar/countdown';
import {calendarInstant,sourceScheduleZone} from '../../src/lib/calendar/time';
import {calendarTime,eventDay} from '../../src/lib/calendar/display';
import type {CalendarItem} from '../../src/lib/calendar/model';

const schedule={companyId:'XSHG:600000',scheduled_date:'2026-11-18',scheduled_at:null,local_time:'09:00',source_timezone:null,timezone_text:null,status:'scheduled' as const};
test('Chinese local clocks without a zone use Beijing, including previously stored schedules and verified Chinese US listings',()=>{
  assert.equal(calendarInstant(schedule),'2026-11-18T01:00:00.000Z');
  assert.equal(eventDay(schedule),'2026-11-17');
  assert.equal(calendarInstant({...schedule,companyId:'US:BABA',companyCountry:'CN'}),'2026-11-18T01:00:00.000Z');
  assert.equal(calendarInstant({...schedule,companyId:'US:NVDA'}),null);
  assert.equal(calendarInstant({...schedule,timezone_text:'CST'}),null);
  assert.equal(calendarInstant({...schedule,timeEvidence:'The call begins at 9:00 a.m. Pacific Time.'}),null);
  assert.equal(sourceScheduleZone('Pacific Time',schedule),'America/Los_Angeles');
  assert.equal(calendarInstant({...schedule,timezone_text:'Pacific Time'}),'2026-11-18T17:00:00.000Z');
  assert.match(calendarTime(schedule as CalendarItem,true),/20:00 ET.*默认按北京时间/);
  assert.equal(calendarInstant({...schedule,scheduled_at:'2026-11-18T17:00:00Z'}),'2026-11-18T17:00:00Z');
});
test('second countdowns reach zero without claiming the actual results were published',()=>{
  const target=Date.parse('2026-11-18T01:00:00Z');
  const value=calendarCountdown(schedule,target-(86400+3*3600+4*60+5)*1000);
  assert.equal(countdownLabel(value),'Starts in 1d 03:04:05');
  assert.equal(countdownLabel(value,true),'倒计时 1天 03:04:05');
  assert.equal(countdownLabel(calendarCountdown(schedule,target-100),true),'倒计时 00:00:01');
  assert.equal(countdownLabel(calendarCountdown(schedule,target),true),'已到公告时间');
  assert.equal(countdownLabel(calendarCountdown(schedule,target+1000)),'Scheduled time reached');
  assert.equal(calendarCountdown({...schedule,status:'cancelled'},target-1000),null);
  assert.equal(countdownLabel(calendarCountdown({...schedule,status:'rescheduled'},target-1000)),'Starts in 00:00:01');
});
test('date-only announcements use calendar days in the source zone without inventing a release time',()=>{
  const dateOnly={...schedule,local_time:null};
  assert.equal(calendarInstant(dateOnly),null);
  assert.equal(countdownLabel(calendarCountdown(dateOnly,Date.parse('2026-11-17T17:00:00Z')),true),'今天 · 时刻未公布（按北京时间日期）');
  assert.equal(countdownLabel(calendarCountdown(dateOnly,Date.parse('2026-11-16T17:00:00Z'))),'In 1 day · time TBD (Beijing date)');
  assert.equal(countdownLabel(calendarCountdown(dateOnly,Date.parse('2026-11-18T17:00:00Z'))),'Scheduled date passed · time TBD (Beijing date)');
  assert.equal(countdownLabel(calendarCountdown({...schedule,companyId:'US:NVDA'},Date.parse('2026-11-17T00:00:00Z'))),'Countdown pending time/time zone confirmation');
});
test('explicit US time zones still follow daylight saving and ambiguous local clocks remain unconfirmed',()=>{
  assert.equal(calendarInstant({...schedule,scheduled_date:'2026-03-08',local_time:'02:30',timezone_text:'ET'}),null);
  assert.equal(calendarInstant({...schedule,scheduled_date:'2026-11-01',local_time:'01:30',timezone_text:'ET'}),null);
  assert.equal(calendarInstant({...schedule,scheduled_date:'2026-07-01',local_time:'09:00',timezone_text:'ET'}),'2026-07-01T13:00:00.000Z');
  assert.equal(calendarInstant({...schedule,scheduled_date:'2026-07-01',local_time:'09:00',timezone_text:'EST'}),null);
  assert.equal(calendarInstant({...schedule,scheduled_date:'2026-11-18',local_time:'09:00',timezone_text:'ET'}),'2026-11-18T14:00:00.000Z');
});
