import {test} from 'node:test';
import {NEWS_SOURCES} from '../../scripts/seed-news-sources';
import assert from 'node:assert/strict';
import { isCalendarCandidate } from '../../src/lib/calendar/candidates';
import { extractSchedule, normalizeSchedules, normalizeExtractedSchedules, scheduleInstant, scheduleTimezone } from '../../src/lib/calendar/extraction';
import { calendarArticleText, fetchCalendarArticle } from '../../src/lib/calendar/article';
import { calendarRange } from '../../src/lib/calendar/service';
import { processCalendarSource, collectCalendarSchedules } from '../../src/lib/calendar/worker';
import { attachCalendarLinks } from '../../src/lib/calendar/intelligence-links';
import type { IntelligenceEvent } from '../../src/lib/intelligence/model';
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
  for(const title of ['Company Cancels Fourth Quarter Earnings Call','Company Postpones Earnings Call','Company Reschedules Results Webcast','Company Cancels Earnings Release'])assert.equal(isCalendarCandidate(title,''),true,title);
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
  const ordinalText='NVIDIA will report third quarter fiscal 2027 results on November 5 th , 2026 after the market closes. NVIDIA will hold an audio webcast the same day at 2:00 p.m. PT.';
  assert.equal(normalize({...draft,date:'2026-11-05',timezoneText:'PT',dateEvidence:ordinalText,timeEvidence:'2:00 p.m. PT'},ordinalText)[0].scheduled_at,'2026-11-05T22:00:00.000Z');
  assert.equal(normalize({...draft,periodEvidence:'third-quarter fiscal 2027 results'},text.replace('third quarter','third-quarter'))[0].fiscalPeriod,'FY2027-Q3');
  const spaced=text.replace(/2026\./g,'2026 .').replace(/Time\./g,'Time .');
  assert.equal(normalize(draft,spaced)[0].scheduled_at,'2026-11-18T22:00:00.000Z');
  const paired='NVIDIA will host its third quarter fiscal 2027 earnings call on November 18, 2026 at 2:00 p.m. PT/5:00 p.m. ET.';
  assert.equal(normalize({...draft,timezoneText:'PT/5:00 p.m. ET',dateEvidence:paired,timeEvidence:'2:00 p.m. PT/5:00 p.m. ET',periodEvidence:'third quarter fiscal 2027 earnings call'},paired)[0].scheduled_at,'2026-11-18T22:00:00.000Z');
  const prior='NVIDIA will report third quarter fiscal 2027 results prior to the market opening on November 18, 2026.';
  assert.equal(normalize({...release,dateEvidence:prior,timeEvidence:'',timeSlot:'before_market'},prior)[0].timeSlot,'before_market');
});
test('rejects unsupported dates, quarters, time zones and archive dates; retains unknown time zones as local time',()=>{
  assert.throws(()=>normalize({...draft,date:'2026-11-17'}),/date/);
  assert.throws(()=>normalize({...draft,dateEvidence:draft.dateEvidence.replace('host','cancel')}),/evidence/);
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

test('ServiceNow close-of-market wording restores both schedules from the cached response without a paid retry',async()=>{
  const nowSource={...source,id:'company_news_now',companyId:'US:NOW',companyIds:['US:NOW'],
    title:'ServiceNow to Announce Third Quarter 2026 Financial Results on October 28',publication_date:'2026-10-07',published_at:'2026-10-07T15:00:00Z'};
  const releaseQuote='ServiceNow (NYSE: NOW) today announced that it will release financial results for the third quarter ended September 30, 2026, following the close of market on Wednesday, October 28, 2026.';
  const callQuote='The conference call will begin at 2 p.m. Pacific Daylight Time (21:00 GMT) on October 28, 2026.';
  const article=releaseQuote+' ServiceNow will host a conference call and live webcast to discuss the financial results. Conference Call Details '+callQuote;
  const release:ScheduleDraft={...draft,kind:'earnings_release',period:'FY2026-Q3',date:'2026-10-28',time:null,timezoneText:null,timeSlot:'after_market',dateEvidence:releaseQuote,timeEvidence:'',periodEvidence:'financial results for the third quarter ended September 30, 2026'};
  const call:ScheduleDraft={...release,kind:'earnings_call',time:'14:00',timezoneText:'Pacific Daylight Time',timeSlot:'unspecified',dateEvidence:article,timeEvidence:callQuote};
  assert.equal(isCalendarCandidate(nowSource.title),true);
  const fake=earningsFirestore();fake.rows.set('events/'+nowSource.id,nowSource);
  const first=await processCalendarSource(fake.db,nowSource,{now:fake.now,download:async()=>article,extract:async()=>response([release,call])});
  assert.equal(first.created,2);
  const receipt=[...fake.rows.entries()].find(([,row])=>row.type==='calendar_extraction')!;
  fake.rows.set(receipt[0],{...receipt[1],status:'review_required',error:'Market session is not established by the source',eventIds:[]});
  for(const [path,row] of fake.rows)if(row.type==='scheduled_event')fake.rows.delete(path);
  const result=await processCalendarSource(fake.db,nowSource,{now:fake.now,download:async()=>article,revalidateCached:true,extract:async()=>{throw new Error('Must reuse cached response');}});
  assert.equal(result.status,'complete');assert.equal(result.paid,false);assert.equal(result.created,2);
  const schedules=[...fake.rows.values()].filter(row=>row.type==='scheduled_event');
  assert.equal(schedules.find(row=>row.eventKind==='earnings_release')?.scheduled_at,null);
  assert.equal(schedules.find(row=>row.eventKind==='earnings_call')?.scheduled_at,'2026-10-28T21:00:00.000Z');
  assert.equal([...fake.rows.keys()].filter(path=>path.startsWith('openai_usage_events/')).length,1);
  assert.throws(()=>normalizeSchedules({events:[{...release,timeSlot:'before_market'}]},nowSource,article,'hash','gpt-6-luna','2026-10-07T16:00:00Z'),/Market session/);

  const event:IntelligenceEvent={id:'news-'+nowSource.id,origin:'US:NOW',companyIds:['US:NOW'],edgeIds:[],category:'BUSINESS',title:nowSource.title,summary:'',published_at:nowSource.published_at,publication_date:'2026-10-07',eventDate:null,planned:false,
    evidence:[{id:nowSource.id,url:nowSource.url,title:nowSource.title,sourceDate:'2026-10-07',channel:'IR'}]};
  const readDb=Object.assign(fake.db,{getAll:(...refs:Array<{get:()=>Promise<unknown>}>)=>Promise.all(refs.map(ref=>ref.get()))}) as Firestore;
  const linked=await attachCalendarLinks(readDb,[event]);
  assert.equal(linked[0].calendarEvents?.length,2);assert(linked[0].calendarEvents?.every(link=>link.day==='2026-10-28'&&link.companyId==='US:NOW'));
  for(const [path,row] of fake.rows)if(row.type==='scheduled_event')fake.rows.set(path,{...row,type:'calendar_review'});
  assert.equal((await attachCalendarLinks(readDb,[event]))[0].calendarEvents,undefined);
  fake.rows.set(receipt[0],{...receipt[1],status:'review_required'});
  assert.equal((await attachCalendarLinks(readDb,[event]))[0].calendarEvents,undefined);
});

test('AMD call referring to these results uses its verified fiscal-period context',()=>{
  const releaseQuote='AMD (NASDAQ: AMD) announced today that it will report fiscal third quarter 2026 financial results on Tuesday, Nov. 3, 2026, after the market close.';
  const callQuote='Management will conduct a conference call to discuss these results at 5 p.m. ET / 2 p.m. PT.';
  const article=`${releaseQuote} ${callQuote}`;
  const amd={...source,companyId:'US:AMD',companyIds:['US:AMD'],title:'AMD to Report Fiscal Third Quarter 2026 Financial Results',publication_date:'2026-10-06',published_at:'2026-10-06T16:00:00Z'};
  const release:ScheduleDraft={...draft,kind:'earnings_release',period:'FY2026-Q3',date:'2026-11-03',time:null,timezoneText:null,timeSlot:'after_market',dateEvidence:releaseQuote,timeEvidence:'',periodEvidence:releaseQuote};
  const call:ScheduleDraft={...release,kind:'earnings_call',time:'17:00',timezoneText:'ET',timeSlot:'unspecified',dateEvidence:article,timeEvidence:callQuote,periodEvidence:'Management will conduct a conference call to discuss these results'};
  const run=(item:ScheduleDraft)=>normalizeSchedules({events:[release,item]},amd,article,'amd','gpt-6-luna','2026-10-06T21:00:00Z');
  const schedules=run(call);
  assert.equal(schedules.length,2);
  assert.equal(schedules[1].scheduled_at,'2026-11-03T22:00:00.000Z');
  assert.equal(schedules[1].periodEvidence,article);
  assert.throws(()=>run({...call,period:'FY2027-Q3'}),/year/);
  assert.throws(()=>run({...call,period:'FY2026-Q2'}),/quarter/);
  assert.throws(()=>run({...call,dateEvidence:callQuote}),/period/);
  assert.throws(()=>run({...call,periodEvidence:'Management will conduct a conference call'}),/year/);
  const fiscal2027=article.replace('fiscal third quarter 2026','third quarter fiscal 2027');
  const runDifferentYear=(period:string)=>normalizeSchedules({events:[{...call,period,dateEvidence:fiscal2027}]},amd,fiscal2027,'amd','gpt-6-luna','2026-10-06T21:00:00Z');
  assert.equal(runDifferentYear('FY2027-Q3')[0].fiscalPeriod,'FY2027-Q3');
  assert.throws(()=>runDifferentYear('FY2026-Q3'),/year/);
  const ambiguous=`${article} Fourth quarter fiscal 2027 results.`;
  assert.throws(()=>normalizeSchedules({events:[{...call,dateEvidence:ambiguous}]},amd,ambiguous,'amd','gpt-6-luna','2026-10-06T21:00:00Z'),/unambiguous/);
});
test('article fetching removes page chrome and refuses unapproved redirects before sending text to the model',async()=>{
  assert.match(calendarArticleText('<body><form><header>menu</header><main><p>The earnings call will begin on October 26, 2026 at 2:00 p.m. Pacific Time.</p></main></form></body>'),/October 26, 2026/);
  assert.equal(calendarArticleText('<nav>menu</nav><article><h1>Results</h1><p>October 26, 2026</p><script>ignore me</script></article><footer>links</footer>').includes('menu'),false);
  let calls=0;
  await assert.rejects(fetchCalendarArticle(source,async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});},NEWS_SOURCES),/approved/);
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
  // Reprocessing an older same-day announcement must not undo a later cancellation.
  fake.rows.set('events/'+schedules[0].id,{...schedules[0],published_at:'2026-10-01T17:00:00Z',status:'cancelled'});
  await processCalendarSource(fake.db,alias,{...deps,download:async()=>text});
  assert.equal(fake.rows.get('events/'+schedules[0].id)?.status,'cancelled');assert.equal(calls,2);
});
test('validation warnings create schedules and HTTP failures record usage without automatically paying twice',async()=>{
  for(const fail of ['validation','http']){
    const fake=earningsFirestore();fake.rows.set('events/'+source.id,source);let calls=0;
    const deps={now:fake.now,download:async()=>text,extract:async()=>{calls++;if(fail==='http')throw new Error('HTTP 429');return response([{...draft,date:'2026-11-17'}]);}};
    await processCalendarSource(fake.db,source,deps);fake.advance(86400001);await processCalendarSource(fake.db,source,deps);
    assert.equal(calls,1);assert.equal([...fake.rows.values()].filter(row=>row.type==='scheduled_event').length,fail==='validation'?1:0);
    if(fail==='validation'){
      const event=[...fake.rows.values()].find(row=>row.type==='scheduled_event')!;
      assert.equal(event.confirmation,'extracted');assert.equal(event.scheduled_date,'2026-11-17');
      assert.deepEqual(event.validationWarnings,['Event date is not established by the source']);
    }
    const usage=[...fake.rows.entries()].find(([path])=>path.startsWith('openai_usage_events/'))![1];
    assert.equal(usage.estimatedCostUsd,fail==='http'?null:0.000305);
    if(fail==='validation')assert.equal((usage.metadata as Record<string,unknown>).validationStatus,'warning');
  }
  const fake=earningsFirestore();fake.rows.set('events/'+source.id,source);
  await processCalendarSource(fake.db,source,{now:fake.now,download:async()=>text,extract:async()=>response()});
  const receipt=[...fake.rows.entries()].find(([,row])=>row.type==='calendar_extraction')!;
  fake.rows.set(receipt[0],{...receipt[1],status:'review_required',error:'Legacy whitespace validation'});
  let paid=0;
  const revalidate={now:fake.now,download:async()=>text,extract:async()=>{paid++;throw new Error('Must not call provider');},revalidateCached:true};
  const readDb=Object.assign(fake.db,{getAll:(...refs:Array<{get:()=>Promise<unknown>}>)=>Promise.all(refs.map(ref=>ref.get()))}) as Firestore;
  fake.rows.set('collectors/earnings-calendar',{afterEventId:'unchanged-history-cursor'});
  const priorKey=process.env.OPENAI_API_KEY,priorModel=process.env.OPENAI_CALENDAR_MODEL;
  delete process.env.OPENAI_API_KEY;process.env.OPENAI_CALENDAR_MODEL='offline-cache-only';
  let result;
  try{result=await collectCalendarSchedules(readDb,new Set(source.companyIds),{...revalidate,extract:undefined,deadline:fake.now()+180000});}
  finally{if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey;
    if(priorModel===undefined)delete process.env.OPENAI_CALENDAR_MODEL;else process.env.OPENAI_CALENDAR_MODEL=priorModel;}
  assert.equal(result.complete,1);assert.equal(result.paid,0);
  assert.equal(fake.rows.get('collectors/earnings-calendar')?.afterEventId,'unchanged-history-cursor');
  assert.equal(fake.rows.get(receipt[0])?.error,null);assert.equal(paid,0);
  const savedUsage=[...fake.rows.entries()].find(([path])=>path.startsWith('openai_usage_events/'))![1];
  assert.equal(savedUsage.estimatedCostUsd,0.000305);assert.equal((savedUsage.metadata as Record<string,unknown>).validationStatus,'complete');
  assert.equal((await processCalendarSource(fake.db,source,{...revalidate,download:async()=>text+' Changed content.'})).status,'cached');
  assert.equal(paid,0);assert.equal([...fake.rows.values()].filter(row=>row.type==='calendar_extraction').length,1);
  assert.equal([...fake.rows.keys()].filter(path=>path.startsWith('openai_usage_events/')).length,1);
});
test('cached revalidation retires rejected event associations and restores independently supported schedules without changing charges',async()=>{
  for(const supported of [false,true]){
    const fake=earningsFirestore();fake.rows.set('events/'+source.id,source);let calls=0;
    const deps={now:fake.now,download:async()=>text,extract:async()=>({...response(),id:'response_'+ ++calls})};
    await processCalendarSource(fake.db,source,deps);
    const receipt=[...fake.rows.entries()].find(([,row])=>row.type==='calendar_extraction')!;
    if(supported){
      const other={...source,id:'independent_source',url:source.url+'-other',published_at:'2026-10-01T15:00:00Z'};
      fake.rows.set('events/'+other.id,other);await processCalendarSource(fake.db,other,deps);
    }
    fake.rows.set(receipt[0],{...receipt[1],output:response([{...draft,date:'2026-11-99'}]).output});
    const before=calls;
    assert.equal((await processCalendarSource(fake.db,source,{...deps,revalidateCached:true})).status,'review_required');
    assert.equal(calls,before);
    const event=[...fake.rows.values()].find(row=>row.id===normalize()[0].id)!;
    assert.equal(event.type,supported?'scheduled_event':'calendar_review');
    assert.deepEqual(event.sourceEventIds,supported?['independent_source']:[]);
    if(supported)assert.equal(event.url,source.url+'-other');
    const charges=[...fake.rows.entries()].filter(([path])=>path.startsWith('openai_usage_events/')).map(([,row])=>row.estimatedCostUsd);
    assert.equal(charges.length,before);assert(charges.every(cost=>cost===0.000305));
  }
});
test('warnings preserve independently extracted activities, missing periods, and local times without inventing invalid dates',()=>{
  const result=normalizeExtractedSchedules({events:[{...draft,kind:'earnings_release',period:'FY2027-Q2'},draft]},source,text,'hash','gpt-6-luna','2026-10-02T12:00:00Z');
  assert.equal(result.schedules.length,2);assert.equal(result.schedules[0].confirmation,'extracted');
  assert.match(result.schedules[0].validationWarnings![0],/quarter/);assert.equal(result.schedules[1].confirmation,'official');
  const partial=normalizeExtractedSchedules({events:[{...draft,date:null,kind:'earnings_release'},draft]},source,text,'hash','gpt-6-luna','2026-10-02T12:00:00Z');
  assert.equal(partial.schedules.length,1);assert.equal(partial.unusable,false);assert.equal(partial.warnings.length,1);
  const unknown=normalizeExtractedSchedules({events:[{...draft,period:null}]},source,text,'hash','gpt-6-luna','2026-10-02T12:00:00Z');
  assert.equal(unknown.schedules.length,1);assert.equal(unknown.schedules[0].fiscalPeriod,'Unspecified');
  const dst=normalizeExtractedSchedules({events:[{...draft,date:'2026-11-01',time:'01:30',timezoneText:'ET'}]},source,text,'hash','gpt-6-luna','2026-10-02T12:00:00Z');
  assert.equal(dst.schedules[0].scheduled_at,null);assert.equal(dst.schedules[0].local_time,'01:30');
  assert(dst.schedules[0].validationWarnings!.some(message=>message.includes('Ambiguous')));
});

test('warning fallback excludes replay and misplaced dates and prefers validated duplicate fields',()=>{
  const rejected=normalizeExtractedSchedules({events:[{...draft,date:'2026-09-01'},{...draft,date:'2028-11-01'},{...draft,dateEvidence:'A replay will be available on November 16, 2026.'}]},source,text,'hash','gpt-6-luna','2026-10-02T12:00:00Z');
  assert.equal(rejected.schedules.length,0);assert.equal(rejected.unusable,true);
  for(const events of [[{...draft,date:'2026-11-17'},draft],[draft,{...draft,date:'2026-11-17'}]]){
    const result=normalizeExtractedSchedules({events},source,text,'hash','gpt-6-luna','2026-10-02T12:00:00Z');
    assert.equal(result.schedules.length,1);assert.equal(result.schedules[0].scheduled_date,draft.date);
    assert.equal(result.schedules[0].scheduled_at,normalize()[0].scheduled_at);
    assert.deepEqual(result.schedules[0].validationWarnings,['Conflicting schedules for the same fiscal event']);
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
