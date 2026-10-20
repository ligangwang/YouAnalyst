import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCalendarSchedules} from '../../src/lib/calendar/reconcile';
import {groupCalendarItems} from '../../src/components/earnings-calendar-groups';
import type {CalendarItem} from '../../src/lib/calendar/model';

const call:CalendarItem={version:1,id:'jbl_q4_call',type:'scheduled_event',companyId:'US:JBL',companyIds:['US:JBL'],eventKind:'earnings_call',fiscalPeriod:'FY2026-Q4',
  scheduled_date:'2026-09-30',scheduled_at:'2026-09-30T12:30:00.000Z',local_time:'08:30',source_timezone:'America/New_York',timezone_text:'ET',time_precision:'exact',timeSlot:'unspecified',
  status:'scheduled',confirmation:'official',sourceEventIds:['company_news_jbl'],dateEvidence:'September 30, 2026',timeEvidence:'8:30 a.m. ET',periodEvidence:'Fourth Quarter and Fiscal Year 2026',
  announcement_date:'2026-09-09',extractionModel:'gpt-6-luna',contentHash:'old',sourceType:'company_ir',sourceId:'jbl-ir',title:'Jabil earnings call',summary:'Fourth Quarter and Fiscal Year 2026',
  url:'https://investors.jabil.com/news/2026/earnings',published_at:'2026-09-09T20:10:00Z',publication_date:'2026-09-09',collected_at:'2026-10-04T03:30:00Z',processed_at:'2026-10-13T21:07:00Z',baseline:true,
  companyName:'Jabil',ticker:'JBL',themes:['ai'],sector:{en:'Systems',zh:'系统',color:'#8faaff'}};
const annual={...call,id:'jbl_annual_call',fiscalPeriod:'FY2026',processed_at:'2026-10-16T21:05:00Z',contentHash:'new'};
const release:CalendarItem={...call,id:'jbl_q4_release',eventKind:'earnings_release',scheduled_at:null,local_time:null,source_timezone:null,timezone_text:null,time_precision:'date',timeSlot:'before_market'};

test('JBL Q4/full-year aliases become one results-and-call card without losing provenance or old links',()=>{
  const input=[release,call,annual],before=structuredClone(input);
  const result=reconcileCalendarSchedules(input);
  assert.equal(result.schedules.length,2);
  const merged=result.schedules.find(item=>item.eventKind==='earnings_call')!;
  assert.equal(merged.id,call.id);assert.equal(merged.contentHash,'new');
  assert.deepEqual(merged.fiscalPeriods,['FY2026-Q4','FY2026']);
  assert.deepEqual(new Set(merged.equivalentScheduleIds),new Set([call.id,annual.id]));
  assert.equal(result.byId.get(annual.id)?.id,call.id);
  const groups=groupCalendarItems(input).get('2026-09-30')!;
  assert.equal(groups.length,1);assert.equal(groups[0].schedules.length,2);
  assert.deepEqual(input,before);
  assert.deepEqual(reconcileCalendarSchedules(result.schedules).schedules,result.schedules);
});

test('the release establishes a Q4 alias for an annual call even when the old quarter call is absent',()=>{
  const result=reconcileCalendarSchedules([annual,release]);
  const merged=result.schedules.find(item=>item.eventKind==='earnings_call')!;
  assert.equal(merged.fiscalPeriod,'FY2026-Q4');
  assert.deepEqual(merged.fiscalPeriods,['FY2026-Q4','FY2026']);
  assert.equal(groupCalendarItems(result.schedules).get('2026-09-30')?.length,1);
  assert.equal(reconcileCalendarSchedules([annual]).schedules[0].fiscalPeriod,'FY2026');
});

test('other periods, issuers, announcement sources and actual start times remain distinct',()=>{
  const separate=[
    {...annual,fiscalPeriod:'FY2026-Q3'}, {...annual,fiscalPeriod:'FY2026-H2'}, {...annual,fiscalPeriod:'FY2025'},
    {...annual,companyId:'US:OTHER'}, {...annual,scheduled_date:'2026-10-01'},
    {...annual,url:'https://example.com/separate',sourceEventIds:['other_source']},
    {...annual,announcement_date:'2026-09-10',sourceEventIds:['other_source']},
    {...annual,scheduled_at:'2026-09-30T13:30:00.000Z',local_time:'09:30'},
    {...annual,scheduled_at:null,local_time:null,time_precision:'date' as const},
  ];
  for(const other of separate)assert.equal(reconcileCalendarSchedules([call,other]).schedules.length,2,JSON.stringify(other));
  assert.equal(groupCalendarItems([call,{...annual,fiscalPeriod:'FY2026-Q3'}]).get('2026-09-30')?.length,2);
  assert.equal(groupCalendarItems([call,{...annual,scheduled_at:'2026-09-30T13:30:00Z'}]).get('2026-09-30')?.length,2);
  assert.equal(reconcileCalendarSchedules([{...call,confirmation:'extracted',validationWarnings:['Fiscal quarter is not supported by source evidence']},annual]).schedules.length,2);
});

test('newer cancellation wins over stale aliases regardless of input order and retains validation warnings',()=>{
  const cancelled={...annual,status:'cancelled' as const,confirmation:'extracted' as const,validationWarnings:['Review fiscal label']};
  for(const input of [[call,cancelled],[cancelled,call]]){
    const result=reconcileCalendarSchedules(input).schedules[0];
    assert.equal(result.id,call.id);assert.equal(result.status,'cancelled');
    assert.deepEqual(result.validationWarnings,['Review fiscal label']);assert.equal(result.confirmation,'extracted');
  }
});

test('tied alias timestamps preserve rescheduled and cancelled status regardless of ID or input order',()=>{
  for(const id of ['aaa','zzz']){
    const moved={...annual,id,processed_at:call.processed_at,status:'rescheduled' as const};
    const cancelled={...call,id:'cancelled',status:'cancelled' as const};
    for(const input of [[call,moved],[moved,call]]){
      assert.equal(reconcileCalendarSchedules(input).schedules[0].status,'rescheduled');
      assert.equal(reconcileCalendarSchedules([...input,cancelled]).schedules[0].status,'cancelled');
    }
  }
});
