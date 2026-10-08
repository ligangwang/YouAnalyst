import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore,DocumentSnapshot} from 'firebase-admin/firestore';
import {analyzeCollectedNews} from '../../src/lib/intelligence/collectors/news-analysis-worker';
import {validateNewsAnalysis,analyzeNewsArticle,type NewsRelationship} from '../../src/lib/intelligence/collectors/news-analysis';
import {graphFromMarket} from '../../src/lib/knowledge-graph/market-store';
import type {GraphNode} from '../../src/lib/knowledge-graph/model';
const now=Date.parse('2026-10-08T12:00:00Z');
const text='Arista and AMD announced a partnership to develop Ethernet networking for AI systems. '+ 'The products are planned for next year. '.repeat(5);
const companies:GraphNode[]=[{id:'US:ANET',name:'Arista',kind:'COMPANY',order:0},{id:'US:AMD',name:'AMD',kind:'COMPANY',order:1}];
const sources=[{id:'arista',companyId:'US:ANET',name:'Arista IR',url:'https://investors.arista.com/feed',allowedHosts:['investors.arista.com'],pollMs:3600000}];
const relationship:NewsRelationship={sourceId:'US:ANET',targetId:'US:AMD',sourceName:'Arista',targetName:'AMD',type:'PARTNER_OF',state:'ANNOUNCED',summaryEn:'Arista and AMD announced a planned AI networking partnership.',summaryZh:'Arista 与 AMD 宣布计划开展 AI 网络合作。',evidence:'Arista and AMD announced a partnership to develop Ethernet networking for AI systems.',eventDate:null,product:'Ethernet networking',confidence:.9};
function fake(){
 const state=new Map<string,Record<string,unknown>>([['events/news',{type:'company_news',sourceType:'company_ir',sourceId:'arista',companyId:'US:ANET',companyIds:['US:ANET'],title:'Arista and AMD announce partnership',url:'https://investors.arista.com/news/partnership',publication_date:'2026-10-08'}]]);
 const ref=(collection:string,id:string)=>({id,path:collection+'/'+id,get:async()=>doc(ref(collection,id))});
 const doc=(r:ReturnType<typeof ref>)=>({id:r.id,ref:r,exists:state.has(r.path),data:()=>state.get(r.path)}) as unknown as DocumentSnapshot;
 const db={collection:(name:string)=>({doc:(id:string)=>ref(name,id)}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{
  const writes:(()=>void)[]=[];
  const result=await fn({get:async(r:ReturnType<typeof ref>)=>doc(r),getAll:async(...refs:ReturnType<typeof ref>[])=>refs.map(doc),create:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>writes.push(()=>{assert(!state.has(r.path));state.set(r.path,data);}),set:(r:ReturnType<typeof ref>,data:Record<string,unknown>,options?:{merge:boolean})=>writes.push(()=>state.set(r.path,options?.merge?{...state.get(r.path),...data}:data)),update:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>writes.push(()=>state.set(r.path,{...state.get(r.path),...data}))});
  writes.forEach(write=>write());return result;
 }} as unknown as Firestore;
 return {state,db,records:[doc(ref('events','news'))]};
}
const output=()=>({analysis:{relationships:[relationship]},model:'gpt-6-luna',responseId:'resp_test',usage:{input_tokens:3000,output_tokens:500,total_tokens:3500}});
const options={now:()=>now,deadline:now+150000,download:async()=>text};

test('full article analysis persists bilingual review candidates once, never published map edges',async()=>{
 const f=fake();let calls=0;
 const config={...options,records:f.records,analyze:async()=>{calls++;return output();}};
 assert.equal((await analyzeCollectedNews(f.db,companies,sources,config)).candidates,1);
 await analyzeCollectedNews(f.db,companies,sources,config);assert.equal(calls,1);
 const receipt=[...f.state.values()].find(row=>row.type==='news_analysis')!;
 assert.equal(receipt.content,text);assert.equal(receipt.status,'complete');
 const candidate=[...f.state.entries()].find(([path])=>path.startsWith('company_relationships/'))![1];
 assert.equal(candidate.status,'NEEDS_REVIEW');assert.equal(candidate.commercialStatus,'ANNOUNCED');
 assert.equal((candidate.summaryTranslations as Record<string,{text:string}>)['zh-CN'].text,relationship.summaryZh);
 const graph=graphFromMarket(companies.map(c=>({...c,status:'PUBLISHED'})),[{...candidate,id:'candidate',source:'US:ANET',target:'US:AMD',type:'PARTNER_OF',status:'NEEDS_REVIEW'}]);
 assert.equal(graph.relationships.length,0);
 const budget=f.state.get('collectors/news-analysis-budget-2026-10')!;
 assert.equal(budget.reservedMicros,0);assert.equal(budget.spentMicros,550);
});

test('no-relationship articles still have a complete cached analysis',async()=>{
 const f=fake();const result=await analyzeCollectedNews(f.db,companies,sources,{...options,records:f.records,analyze:async()=>({...output(),analysis:{relationships:[]}})});
 assert.equal(result.complete,1);assert.equal(result.candidates,0);
});

test('provider ambiguity blocks duplicate paid calls and retains the budget reservation',async()=>{
 const f=fake();let calls=0;
 const config={...options,records:f.records,analyze:async()=>{calls++;throw new Error('timeout');}};
 await analyzeCollectedNews(f.db,companies,sources,config);await analyzeCollectedNews(f.db,companies,sources,config);
 assert.equal(calls,1);assert.equal([...f.state.values()].find(row=>row.type==='news_analysis')!.status,'review_required');
 assert(Number(f.state.get('collectors/news-analysis-budget-2026-10')!.reservedMicros)>0);
});

test('fetch failures retry later without paid calls; unapproved hosts never fetch',async()=>{
 const f=fake();let downloads=0,calls=0;
 const config={...options,records:f.records,download:async()=>{downloads++;throw new Error('unavailable');},analyze:async()=>{calls++;return output();}};
 await analyzeCollectedNews(f.db,companies,sources,config);await analyzeCollectedNews(f.db,companies,sources,config);
 assert.equal(downloads,1);assert.equal(calls,0);
 const g=fake();g.state.get('events/news')!.url='https://127.0.0.1/private';
 await analyzeCollectedNews(g.db,companies,sources,{...config,records:g.records});assert.equal(downloads,1);
});

test('budget exhaustion prevents the paid request',async()=>{
 const f=fake();f.state.set('collectors/news-analysis-budget-2026-10',{spentMicros:5000000,reservedMicros:0});let calls=0;
 const result=await analyzeCollectedNews(f.db,companies,sources,{...options,records:f.records,analyze:async()=>{calls++;return output();}});
 assert.equal(result.budgetBlocked,1);assert.equal(calls,0);
});

test('invented evidence, IDs and lost language or planned status fail validation',()=>{
 assert.equal(validateNewsAnalysis({relationships:[relationship]},text,companies).relationships.length,1);
 for(const patch of [{evidence:'Invented contract signed by companies.'},{targetId:'US:WRONG'},{summaryZh:'English only'},{type:'PLANNED_ADOPTER_OF',state:'DOCUMENTED'}])assert.throws(()=>validateNewsAnalysis({relationships:[{...relationship,...patch}]},text,companies));
});

test('edited source cannot receive candidates for an old snapshot; unresolved names stay in analysis',async()=>{
 const f=fake();await analyzeCollectedNews(f.db,companies,sources,{...options,records:f.records,analyze:async()=>{f.state.get('events/news')!.title='Changed title';return output();}});
 assert(![...f.state.keys()].some(path=>path.startsWith('company_relationships/')));assert.equal(f.state.get('events/news')!.newsAnalysis,undefined);
 const g=fake();await analyzeCollectedNews(g.db,companies,sources,{...options,records:g.records,analyze:async()=>({...output(),analysis:{relationships:[{...relationship,targetId:''}]}})});
 assert(![...g.state.keys()].some(path=>path.startsWith('company_relationships/')));
 assert.equal(([...g.state.values()].find(row=>row.type==='news_analysis')!.analysis as {relationships:unknown[]}).relationships.length,1);
});

test('API uses full article text with structured bilingual output and no paid search',async()=>{
 const request:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(JSON.parse(body.input).content,text);assert.equal(body.text.format.strict,true);return Response.json({status:'completed',id:'resp_test',output:[{content:[{type:'output_text',text:JSON.stringify(output().analysis)}]}]});};
 const result=await analyzeNewsArticle('Headline',text,companies,{key:'isolated-test-key',request});assert.equal(validateNewsAnalysis(result.analysis,text,companies).relationships.length,1);
});

test('duplicate observations in a response produce one review record',async()=>{
 const f=fake();const result=await analyzeCollectedNews(f.db,companies,sources,{...options,records:f.records,analyze:async()=>({...output(),analysis:{relationships:[relationship,{...relationship,product:'Another scope'}]}})});
 assert.equal(result.candidates,1);
 assert.equal([...f.state.keys()].filter(path=>path.startsWith('company_relationships/')).length,1);
});
