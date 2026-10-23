import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentSnapshot} from 'firebase-admin/firestore';
import {articleFingerprint,parseArticleTask,publishArticleTasks,processArticleTask} from '../../src/lib/intelligence/collectors/article-queue';
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
