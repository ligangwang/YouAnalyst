import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentSnapshot} from 'firebase-admin/firestore';
import {deferExcludedArticles,articleFingerprint,parseArticleTask,publishArticleTasks,processArticleTask} from '../../src/lib/intelligence/collectors/article-queue';
import {earningsFirestore} from '../helpers/earnings-firestore';
import {EVENTS_COLLECTION} from '../../src/lib/events/model';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
const at='2026-10-23T12:00:00.000Z',now=()=>Date.parse(at);
const row={type:'company_news',companyId:'US:AMD',companyIds:['US:AMD'],sourceId:'amd-ir',url:'https://ir.amd.com/news/test',title:'New product',publication_date:'2026-10-23'};
const task={version:1 as const,type:'news.article.enrichment.requested' as const,batchId:'article_'+'b'.repeat(64),articleId:'news-one',fingerprint:articleFingerprint(row),stages:['analysis','headline','calendar'] as ['analysis','headline','calendar'],requestedAt:at};
const doc=(id:string,data=row)=>({id,data:()=>data}) as unknown as DocumentSnapshot;
const graph:KnowledgeGraph={nodes:[{id:'US:AMD',name:'AMD',kind:'COMPANY',market:'US',order:0}],relationships:[],sources:[],asOf:''};
const sources=[{id:'amd-ir',companyId:'US:AMD',name:'AMD IR',url:'https://ir.amd.com/news',allowedHosts:['ir.amd.com'],pollMs:3600000}];
const context=async()=>({graph,sources});
test('article tasks bind one immutable source snapshot, strip URLs and reject arbitrary work',()=>{
 assert.deepEqual(parseArticleTask({...task,url:'https://evil.invalid'}),task);
 for(const patch of [{articleId:'../other'},{fingerprint:'bad'},{stages:['all']},{stages:['analysis','analysis']},{stages:[]}])assert.throws(()=>parseArticleTask({...task,...patch}));
 assert.equal(articleFingerprint({...row,titleTranslations:{en:{text:'translation'}}}),task.fingerprint);
 assert.notEqual(articleFingerprint({...row,title:'Corrected source'}),task.fingerprint);
});
test('one article task combines selected stages and keeps per-run admission bounds',async()=>{
 const sent:ReturnType<typeof parseArticleTask>[]=[],records=Array.from({length:100},(_,i)=>doc('article-'+i));
 const result=await publishArticleTasks({analysis:records,headline:records,calendar:records},async t=>{sent.push(t);},{execution:'run',now,deadline:now()+60000});
 assert.equal(result.requested,40);assert.equal(sent.filter(t=>t.stages.includes('analysis')).length,20);assert.equal(sent.filter(t=>t.stages.includes('calendar')).length,25);
 assert.deepEqual(sent[0].stages,['analysis','headline','calendar']);
 const again:typeof sent=[];await publishArticleTasks({analysis:records,headline:records,calendar:records},async t=>{again.push(t);},{execution:'run',now,deadline:now()+60000});assert.deepEqual(again,sent);
 const expired=await publishArticleTasks({analysis:[doc('one')],headline:[],calendar:[]},async()=>assert.fail(),{execution:'run',now,deadline:now()+1000});assert.equal(expired.deferred,1);
});
test('article worker fences concurrent deliveries, releases failed work, and rejects changed sources',async()=>{
 const f=earningsFirestore();f.rows.set(`${EVENTS_COLLECTION}/news-one`,row);let release!:()=>void,started!:()=>void;
 const ready=new Promise<void>(r=>{started=r;}),gate=new Promise<void>(r=>{release=r;});let calls=0;
 const opts={enabled:true,calendarEnabled:true,now,context,run:async()=>{calls++;started();await gate;return {status:'verified'};}};
 const first=processArticleTask(task,f.db,opts);await ready;
 await assert.rejects(processArticleTask(task,f.db,opts),/busy/);release();assert.equal((await first).status,'verified');assert.equal(calls,1);
 f.rows.set(`${EVENTS_COLLECTION}/news-one`,{...row,title:'Changed'});
 assert.equal((await processArticleTask(task,f.db,opts)).status,'stale');assert.equal(calls,1);
 await assert.rejects(processArticleTask(task,f.db,{...opts,enabled:false}),/disabled/);
});
test('a failed task releases its outer lease while durable stage intents own paid retry safety',async()=>{
 const f=earningsFirestore();f.rows.set(`${EVENTS_COLLECTION}/news-one`,row);
 await assert.rejects(processArticleTask(task,f.db,{enabled:true,calendarEnabled:true,now,context,run:async()=>{throw Error('persistence');}}),/persistence/);
 assert.equal((await processArticleTask(task,f.db,{enabled:true,calendarEnabled:true,now,context,run:async()=>({status:'verified'})})).status,'verified');
});
test('withdrawn company or source and unapproved URLs cannot reach any enrichment stage',async()=>{
 const f=earningsFirestore();f.rows.set(`${EVENTS_COLLECTION}/news-one`,row);
 const run=async()=>assert.fail('No download or paid request may run');
 for(const current of [{graph:{...graph,nodes:[]},sources},{graph,sources:[]},{graph,sources:[{...sources[0],allowedHosts:['other.amd.com']}]}]){
  assert.equal((await processArticleTask(task,f.db,{enabled:true,calendarEnabled:true,now,context:async()=>current,run})).status,'ineligible');
 }
});
test('articles mentioning multiple companies remain owned by their approved publisher company',async()=>{
 const f=earningsFirestore(),multi={...row,companyIds:['US:AMD','US:NVDA']};
 f.rows.set(`${EVENTS_COLLECTION}/news-one`,multi);
 const next={...task,fingerprint:articleFingerprint(multi)};let called=0;
 assert.equal((await processArticleTask(next,f.db,{enabled:true,calendarEnabled:true,now,context,run:async()=>{called++;return {status:'verified'};}})).status,'verified');assert.equal(called,1);
 f.rows.set(`${EVENTS_COLLECTION}/news-one`,{...multi,companyId:'US:WITHDRAWN'});
 assert.equal((await processArticleTask({...next,fingerprint:articleFingerprint({...multi,companyId:'US:WITHDRAWN'})},f.db,{enabled:true,calendarEnabled:true,now,context,run:async()=>assert.fail()})).status,'ineligible');
});

test('excluded due pages advance with bounded guarded deferrals and preserve later enrollment',async()=>{
 const f=earningsFirestore(),field='newsAnalysisNextCheckAtMs';
 for(let i=0;i<201;i++)f.rows.set(`${EVENTS_COLLECTION}/page-${String(i).padStart(3,'0')}`,{...row,companyIds:i===200?['US:AMD']:['US:OLD'],[field]:0});
 const eligible=(d:DocumentSnapshot)=>d.get('companyIds').includes('US:AMD');
 for(let round=0;round<5;round++){
  const due=(await f.db.collection(EVENTS_COLLECTION).get()).docs.filter(d=>d.get(field)<=now()).slice(0,200);
  assert.equal(await deferExcludedArticles(f.db,due,field,eligible,now()),40);
 }
 const remaining=(await f.db.collection(EVENTS_COLLECTION).get()).docs.filter(d=>d.get(field)<=now());
 assert.equal(remaining.length,1);assert(eligible(remaining[0]));
 assert.equal(f.rows.get(`${EVENTS_COLLECTION}/page-000`)![field],now()+86400000);
 const ref=f.db.collection(EVENTS_COLLECTION).doc('page-000'),snapshot=await ref.get(),saved=snapshot.data()!,stale={...snapshot,data:()=>saved} as DocumentSnapshot;
 f.rows.set(`${EVENTS_COLLECTION}/page-000`,{...stale.data(),[field]:Number.MAX_SAFE_INTEGER});
 await deferExcludedArticles(f.db,[stale],field,()=>false,now());
 assert.equal(f.rows.get(`${EVENTS_COLLECTION}/page-000`)![field],Number.MAX_SAFE_INTEGER);
});
test('calendar deferrals retire non-candidates and postpone withdrawn companies without paid work',async()=>{
 const f=earningsFirestore(),field='calendarNextCheckAtMs';
 for(const [id,title] of [['candidate','AMD will host Q3 earnings conference call'],['other','New product']])f.rows.set(`${EVENTS_COLLECTION}/${id}`,{...row,title,sourceType:'company_ir',[field]:0});
 const docs=(await f.db.collection(EVENTS_COLLECTION).get()).docs;
 await deferExcludedArticles(f.db,docs,field,()=>false,now());
 assert.equal(f.rows.get(`${EVENTS_COLLECTION}/candidate`)![field],now()+86400000);
 assert.equal(f.rows.get(`${EVENTS_COLLECTION}/other`)![field],Number.MAX_SAFE_INTEGER);
});
