import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore,DocumentSnapshot} from 'firebase-admin/firestore';
import {needsHeadlineTranslation,translateHeadlines,translateCollectedHeadlines} from '../../src/lib/intelligence/collectors/headline-translations';
import {intelligenceEventTitle} from '../../src/lib/intelligence/model';
const title='Broadcom Announces New AI Networks at 2026 Summit';
const chinese='博通在 2026 年峰会上发布全新 AI 网络';
const at=Date.parse('2026-10-08T17:00:00Z');
function fake(){
 const state=new Map<string,Record<string,unknown>>([['events/news',{type:'company_news',sourceType:'company_ir',companyId:'US:AVGO',title,published_at:'2026-10-08T12:00:00Z'}]]);
 const ref=(collection:string,id:string)=>({id,path:collection+'/'+id});
 const doc=(r:ReturnType<typeof ref>)=>({id:r.id,ref:r,exists:state.has(r.path),data:()=>state.get(r.path)}) as unknown as DocumentSnapshot;
 const db={collection:(name:string)=>({doc:(id:string)=>ref(name,id)}),runTransaction:async(fn:(tx:unknown)=>unknown)=>fn({getAll:async(...refs:ReturnType<typeof ref>[])=>refs.map(doc),get:async(r:ReturnType<typeof ref>)=>doc(r),create:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>state.set(r.path,data),update:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>{const old=state.get(r.path)!;for(const [key,value] of Object.entries(data)){if(key.startsWith('titleTranslations.'))old.titleTranslations={...(old.titleTranslations as object??{}),[key.slice('titleTranslations.'.length)]:value};else old[key]=value;}}})} as unknown as Firestore;
 return {db,state,records:[doc(ref('events','news'))]};
}
test('filing labels localize without changing the original title or filing type',()=>{
 const event={title:'MOD · 4 filing',evidence:[{channel:'SEC' as const,id:'sec',url:'https://sec.gov',title:'original',sourceDate:null}]};
 assert.equal(intelligenceEventTitle(event,'zh-CN'),'MOD · 内部人交易 (Form 4)');assert.equal(intelligenceEventTitle(event,'en'),'MOD · Insider trade (Form 4)');
 assert.equal(intelligenceEventTitle({...event,title:'MOD · 144 filing'},'en'),'MOD · Planned insider sale (Form 144)');
});
test('translation response validates all IDs, Chinese text, completion and dates',async()=>{
 const request:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.text.format.strict,true);return Response.json({id:'response',model:'gpt-6-luna',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({translations:[{id:'news',text:chinese}]})}]}]});};
 assert.equal((await translateHeadlines([{id:'news',title}],{key:'isolated-test-key',request})).translations[0].text,chinese);
 for(const output of [{translations:[{id:'other',text:chinese}]},{translations:[{id:'news',text:'博通发布新网络'}]},{translations:[]}])await assert.rejects(translateHeadlines([{id:'news',title}],{key:'isolated-test-key',request:async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]})}));
});
test('stored translations survive repeated scans without repeating provider calls or modifying original source data',async()=>{
 const f=fake();let calls=0;
 const options={records:f.records,now:()=>at,deadline:at+150_000,translate:async()=>{calls++;return {translations:[{id:'news',text:chinese}],model:'gpt-6-luna',responseId:'response',usage:{input_tokens:20,output_tokens:10}};}};
 assert.equal((await translateCollectedHeadlines(f.db,new Set(['US:AVGO']),options)).translated,1);
 await translateCollectedHeadlines(f.db,new Set(['US:AVGO']),options);assert.equal(calls,1);
 const saved=f.state.get('events/news')!;assert.equal(saved.title,title);assert.equal(saved.published_at,'2026-10-08T12:00:00Z');assert.equal(needsHeadlineTranslation(saved),false);
 assert([...f.state.keys()].some(path=>path.startsWith('openai_usage_events/')));
});
test('failed or crashed paid requests are held for review rather than repeated each poll',async()=>{
 const f=fake();let calls=0;
 const options={records:f.records,now:()=>at,deadline:at+150_000,translate:async()=>{calls++;throw Error('Timeout');}};
 await translateCollectedHeadlines(f.db,new Set(['US:AVGO']),options);await translateCollectedHeadlines(f.db,new Set(['US:AVGO']),options);assert.equal(calls,1);
 assert.equal(needsHeadlineTranslation({type:'company_news',title,titleTranslationState:{source:title,status:'requesting'}}),false);
 assert.equal(needsHeadlineTranslation({type:'company_news',title:'Changed headline',titleTranslationState:{source:title,status:'requesting'}}),true);
});
test('headline edited while a request runs never receives a translation for the old source',async()=>{
 const f=fake();const result=await translateCollectedHeadlines(f.db,new Set(['US:AVGO']),{records:f.records,now:()=>at,deadline:at+150_000,translate:async()=>{f.state.get('events/news')!.title='Changed';return {translations:[{id:'news',text:chinese}],model:'gpt-6-luna',responseId:'response',usage:null};}});
 assert.equal(result.translated,0);assert.equal(f.state.get('events/news')!.titleTranslations,undefined);
});

test('HTML character entities are not treated as headline years',async()=>{
 const request:typeof fetch=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({translations:[{id:'news',text:'机器学习研究代理为何不会过拟合？'}]})}]}]});
 assert.equal((await translateHeadlines([{id:'news',title:'Why don&#8217;t machine learning research agents overfit?'}],{key:'isolated-test-key',request})).translations.length,1);
});

test('Chinese exchange headlines are translated once into stored English and follow the selected language',async()=>{
 const f=fake(),source='关于召开2026年股东大会的公告',english='Announcement of the 2026 Shareholders Meeting';
 f.state.set('events/news',{type:'company_disclosure',sourceType:'exchange',companyId:'XSHE:300308',title:source,published_at:'2026-10-08T12:00:00Z'});
 let calls=0;
 const options={records:f.records,now:()=>at,deadline:at+150_000,translate:async()=>{calls++;return {translations:[{id:'news',text:english}],model:'gpt-6-luna',responseId:'english',usage:null};}};
 assert.equal((await translateCollectedHeadlines(f.db,new Set(['XSHE:300308']),options)).translated,1);
 await translateCollectedHeadlines(f.db,new Set(['XSHE:300308']),options);assert.equal(calls,1);
 const saved=f.state.get('events/news')!;assert.equal((saved.titleTranslations as Record<string,{text:string}>).en.text,english);assert.equal(saved.title,source);
 const event={title:source,titleEn:english,evidence:[]};assert.equal(intelligenceEventTitle(event,'en'),english);assert.equal(intelligenceEventTitle(event,'zh-CN'),source);
 const request:typeof fetch=async(_url,init)=>{assert.equal(JSON.parse(JSON.parse(String(init?.body)).input)[0].targetLanguage,'English');return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({translations:[{id:'news',text:english}]})}]}]});};
 assert.equal((await translateHeadlines([{id:'news',title:source}],{key:'isolated-test-key',request})).translations[0].text,english);
 await assert.rejects(translateHeadlines([{id:'news',title:source}],{key:'isolated-test-key',request:async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({translations:[{id:'news',text:source}]})}]}]})}));
});
