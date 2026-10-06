import {test} from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarCandidate } from '../../src/lib/calendar/candidates';
import { extractSchedule, normalizeSchedules, scheduleInstant, scheduleTimezone } from '../../src/lib/calendar/extraction';
import { calendarArticleText, fetchCalendarArticle } from '../../src/lib/calendar/article';
import { calendarRange } from '../../src/lib/calendar/service';
import { processCalendarSource } from '../../src/lib/calendar/worker';
import { buildOpenAiUsageEvent, listOpenAiUsageEvents } from '../../src/lib/openai/usage';
import type { Firestore } from 'firebase-admin/firestore';
import { earningsFirestore } from '../helpers/earnings-firestore';
import type { CalendarSource, ScheduleDraft } from '../../src/lib/calendar/model';

const source:CalendarSource={version:1,id:'news_example',type:'company_news',companyId:'US:NVDA',companyIds:['US:NVDA'],sourceId:'nvidia-news',sourceType:'company_ir',
  title:'NVIDIA Sets Conference Call for Third Quarter Financial Results',summary:'',url:'https://nvidianews.nvidia.com/news/example',
  published_at:'2026-10-01T16:00:00Z',publication_date:'2026-10-01',collected_at:'2026-10-02T11:00:00Z',processed_at:'2026-10-02T11:00:01Z',baseline:false};
const text='NVIDIA will report third quarter fiscal 2027 results on November 18, 2026 after the market closes. NVIDIA will host its earnings call on November 18, 2026 at 2:00 p.m. Pacific Time. An archived replay will be available on November 19, 2026 at 5:00 p.m. Pacific Time.';
const draft:ScheduleDraft={kind:'earnings_call',period:'FY2027-Q3',date:'2026-11-18',time:'14:00',timezoneText:'Pacific Time',timeSlot:'unspecified',status:'scheduled',
  dateEvidence:'NVIDIA will host its earnings call on November 18, 2026 at 2:00 p.m. Pacific Time.',timeEvidence:'2:00 p.m. Pacific Time',periodEvidence:'third quarter fiscal 2027 results'};
const normalize=(item:ScheduleDraft=draft,article=text)=>normalizeSchedules({events:[item]},source,article,'abc','gpt-6-luna','2026-10-02T11:00:00Z');
const response=(items:ScheduleDraft[]=[draft])=>({id:'response_1',model:'gpt-6-luna',status:'completed',usage:{input_tokens:2000,input_tokens_details:{cached_tokens:500},output_tokens:300,total_tokens:2300},output:JSON.stringify({events:items})});

test('title detection accepts scheduling, same-day results calls and Chinese announcements, excluding ordinary business news',()=>{
  for(const title of ['Cadence Announces Third Quarter 2026 Financial Results Webcast','Lumentum Announces Reporting Date for Fourth Quarter and Fiscal Year 2026 Results','Micron to Report Fiscal 2026 Financial Results','NVIDIA Sets Conference Call for Third Quarter Financial Results','关于召开2026年半年度业绩说明会的公告','AMD Reports Third Quarter 2026 Financial Results'])assert.equal(isCalendarCandidate(title,''),true,title);
  for(const title of ['Cadence launches new AI platform','NVIDIA robotics partnerships','New Satellite Service Launch'])assert.equal(isCalendarCandidate(title,''),false,title);
});
test('preserves original publication timestamps and separates release and call schedules without inventing a release clock',()=>{
  const release:ScheduleDraft={...draft,kind:'earnings_release',time:null,timezoneText:null,timeSlot:'after_market',dateEvidence:'NVIDIA will report third quarter fiscal 2027 results on November 18, 2026 after the market closes.',timeEvidence:'after the market closes'};
  const items=normalizeSchedules({events:[release,draft]},source,text,'abc','gpt-6-luna','2026-10-03T00:00:00Z');
  assert.equal(items.length,2);assert.notEqual(items[0].id,items[1].id);
  assert.equal(items[0].scheduled_at,null);assert.equal(items[1].scheduled_at,'2026-11-18T22:00:00.000Z');
  assert.equal(items[1].published_at,source.published_at);assert.equal(items[1].collected_at,source.collected_at);
  const moved=normalize({...draft,date:'2026-11-20',dateEvidence:'The earnings call is rescheduled to November 20, 2026.',status:'rescheduled'},text+' The earnings call is rescheduled to November 20, 2026.')[0];
  assert.equal(moved.id,items[1].id);
});
test('rejects unsupported dates, quarters, time zones and archive dates; retains unknown time zones as local time',()=>{
  assert.throws(()=>normalize({...draft,date:'2026-11-17'}),/date/);
  assert.throws(()=>normalize({...draft,time:'17:00'}),/time/);
  assert.throws(()=>normalize({...draft,period:'FY2027-Q2'}),/quarter/);
  assert.throws(()=>normalize({...draft,timezoneText:'ET'}),/Timezone/);
  assert.throws(()=>normalize({...draft,date:'2026-11-19',dateEvidence:'An archived replay will be available on November 19, 2026 at 5:00 p.m. Pacific Time.'}),/Replay/);
  assert.equal(normalize({...draft,timezoneText:null})[0].scheduled_at,null);
  assert.equal(scheduleTimezone('CST'),null);assert.equal(scheduleTimezone('北京时间'),'Asia/Shanghai');
  assert.throws(()=>scheduleInstant('2026-03-08','02:30','America/New_York'),/nonexistent/);
  assert.throws(()=>scheduleInstant('2026-11-01','01:30','America/New_York'),/Ambiguous/);
  assert.throws(()=>calendarRange('2026-01-01','2026-04-01'),/range/);
});
test('article fetching removes page chrome and refuses unapproved redirects before sending text to the model',async()=>{
  assert.equal(calendarArticleText('<nav>menu</nav><article><h1>Results</h1><p>October 26, 2026</p><script>ignore me</script></article><footer>links</footer>').includes('menu'),false);
  let calls=0;
  await assert.rejects(fetchCalendarArticle(source,async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});}),/approved/);
  assert.equal(calls,1);
});
test('Responses request uses Luna, a strict schema and no storage; cost comes from returned tokens including cached input',async()=>{
  await extractSchedule(source,text,{key:'isolated-test-key',request:async(url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(String(init?.body));
    assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);
    return Response.json({...response(),output:[{content:[{type:'output_text',text:response().output}]}]});
  }});
  const usage=buildOpenAiUsageEvent({purpose:'earnings_calendar_extraction',model:'gpt-6-luna-2026-10-01',responseId:'r',usage:response().usage});
  assert.equal(usage.estimatedCostUsd,0.000305);
  assert.equal(buildOpenAiUsageEvent({purpose:'earnings_calendar_extraction',model:'gpt-6-luna',responseId:'failed',usage:null}).estimatedCostUsd,null);
});
test('concurrent and duplicate documents make one paid request, store schedules and charge once; corrected content makes a new request',async()=>{
  const fake=earningsFirestore();fake.rows.set('events/'+source.id,source);
  let calls=0,article=text;
  const deps={now:fake.now,download:async()=>article,extract:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return {...response(),id:'response_'+calls};}};
  await Promise.all([processCalendarSource(fake.db,source,deps),processCalendarSource(fake.db,source,deps)]);
  assert.equal(calls,1);assert.equal([...fake.rows.keys()].filter(path=>path.startsWith('openai_usage_events/')).length,1);
  const alias={...source,id:'another_doc'};fake.rows.set('events/'+alias.id,alias);
  await processCalendarSource(fake.db,alias,deps);assert.equal(calls,1);
  article+=' An updated contact address.';fake.advance(86400001);
  await processCalendarSource(fake.db,source,deps);assert.equal(calls,2);
  const schedules=[...fake.rows.values()].filter(row=>row.type==='scheduled_event');assert.equal(schedules.length,1);
  assert.deepEqual((schedules[0].sourceEventIds as string[]).sort(),[alias.id,source.id].sort());
});
test('validation and HTTP failures record usage without automatically paying for the same content again',async()=>{
  for(const fail of ['validation','http']){
    const fake=earningsFirestore();fake.rows.set('events/'+source.id,source);let calls=0;
    const deps={now:fake.now,download:async()=>text,extract:async()=>{calls++;if(fail==='http')throw new Error('HTTP 429');return response([{...draft,date:'2026-11-17'}]);}};
    await processCalendarSource(fake.db,source,deps);fake.advance(86400001);await processCalendarSource(fake.db,source,deps);
    assert.equal(calls,1);assert.equal([...fake.rows.values()].filter(row=>row.type==='scheduled_event').length,0);
    const usage=[...fake.rows.entries()].find(([path])=>path.startsWith('openai_usage_events/'))![1];
    assert.equal(usage.estimatedCostUsd,fail==='http'?null:0.000305);
  }
});
test('a failed commit retries persistence only, never the provider call',async()=>{
  const fake=earningsFirestore();fake.rows.set('events/'+source.id,source);let rejects=0,calls=0;
  fake.reject((path)=>path.startsWith('openai_usage_events/')&&rejects++===0);
  await processCalendarSource(fake.db,source,{now:fake.now,download:async()=>text,extract:async()=>{calls++;return response();}});
  assert.equal(calls,1);assert.equal([...fake.rows.values()].filter(row=>row.type==='scheduled_event').length,1);
});

test('admin period totals include more than one page and remain independent of the recent table limit',async()=>{
  const ledger=Array.from({length:601},(_,index)=>buildOpenAiUsageEvent({purpose:'earnings_calendar_extraction',model:'gpt-6-luna',responseId:`r_${String(index).padStart(4,'0')}`,usage:index===600?null:response().usage,createdAt:'2026-10-02T10:00:00Z'}));
  ledger.push(buildOpenAiUsageEvent({purpose:'industry_research',model:'gpt-6-luna',responseId:'other',usage:response().usage,createdAt:'2026-10-02T10:00:00Z'}));
  const query=(filters:Array<(item:typeof ledger[number])=>boolean>=[],bound=10000,after='',direction='asc')=>({
    where:(field:string,op:string,value:string)=>query([...filters,item=>op==='=='?item[field as 'purpose']===value:item[field as 'createdAt']>=value],bound,after,direction),
    orderBy:(_field:string,dir='asc')=>query(filters,bound,after,dir),limit:(n:number)=>query(filters,n,after,direction),startAfter:(doc:{id:string})=>query(filters,bound,doc.id,direction),
    get:async()=>{const items=ledger.filter(item=>filters.every(filter=>filter(item))&&item.id>after).sort((a,b)=>direction==='desc'?b.id.localeCompare(a.id):a.id.localeCompare(b.id)).slice(0,bound);return {size:items.length,docs:items.map(item=>({id:item.id,data:()=>item}))};},
  });
  const db={collection:()=>query()} as unknown as Firestore;
  const result=await listOpenAiUsageEvents(2,db,new Date('2026-10-05T12:00:00Z'));
  assert.equal(result.events.length,2);assert.equal(result.last30Days.eventCount,602);
  assert.equal(result.calendarThisQuarter.eventCount,601);assert.equal(result.calendarLast30Days.unknownCostCount,1);
  assert.equal(result.calendarThisQuarter.estimatedCostUsd,0.183);
});
