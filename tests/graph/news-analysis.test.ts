import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore,DocumentSnapshot} from 'firebase-admin/firestore';
import {analyzeCollectedNews} from '../../src/lib/intelligence/collectors/news-analysis-worker';
import {validateNewsAnalysis,analyzeNewsArticle,createNewsCompanyResolver,resolveNewsAnalysis,type NewsRelationship} from '../../src/lib/intelligence/collectors/news-analysis';
import {graphFromMarket} from '../../src/lib/knowledge-graph/market-store';
import type {GraphNode} from '../../src/lib/knowledge-graph/model';
const now=Date.parse('2026-10-08T12:00:00Z');
const text='Arista and AMD announced a partnership to develop Ethernet networking for AI systems. '+ 'The products are planned for next year. '.repeat(5);
const companies:GraphNode[]=[{id:'US:ANET',name:'Arista',kind:'COMPANY',order:0},{id:'US:AMD',name:'AMD',kind:'COMPANY',order:1}];
const sources=[{id:'arista',companyId:'US:ANET',name:'Arista IR',url:'https://investors.arista.com/feed',allowedHosts:['investors.arista.com'],pollMs:3600000}];
const relationship:NewsRelationship={sourceId:'US:ANET',targetId:'US:AMD',sourceName:'Arista',targetName:'AMD',type:'PARTNER_OF',state:'ANNOUNCED',summaryEn:'Arista and AMD announced a planned AI networking partnership.',summaryZh:'Arista 与 AMD 宣布计划开展 AI 网络合作。',evidence:'Arista and AMD announced a partnership to develop Ethernet networking for AI systems.',eventDate:null,product:'Ethernet networking',confidence:.9};
function fake(){
 let receiptReads=0;
 const state=new Map<string,Record<string,unknown>>([['events/news',{type:'company_news',sourceType:'company_ir',sourceId:'arista',companyId:'US:ANET',companyIds:['US:ANET'],title:'Arista and AMD announce partnership',url:'https://investors.arista.com/news/partnership',publication_date:'2026-10-08'}]]);
 const ref=(collection:string,id:string)=>({id,path:collection+'/'+id,get:async()=>{receiptReads++;return doc(ref(collection,id));},
  set:async(data:Record<string,unknown>)=>{state.set(collection+'/'+id,{...state.get(collection+'/'+id),...data});}});
 const doc=(r:ReturnType<typeof ref>)=>({id:r.id,ref:r,exists:state.has(r.path),data:()=>state.get(r.path)}) as unknown as DocumentSnapshot;
 const db={collection:(name:string)=>({doc:(id:string)=>ref(name,id),where:(field:string,op:string,value:number)=>{
  assert.equal(name,'events');assert.equal(field,'newsAnalysisNextCheckAtMs');assert.equal(op,'<=');
  return {orderBy:(order:string)=>{assert.equal(order,field);return {limit:(limit:number)=>({get:async()=>({
   docs:[...state].filter(([path,row])=>path.startsWith('events/')&&typeof row[field]==='number'&&Number(row[field])<=value)
    .sort((a,b)=>Number(a[1][field])-Number(b[1][field])).slice(0,limit).map(([path])=>doc(ref(name,path.slice(name.length+1)))),
  })})};}};
 }}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{
  const writes:(()=>void)[]=[];
  const result=await fn({get:async(r:ReturnType<typeof ref>)=>doc(r),getAll:async(...refs:ReturnType<typeof ref>[])=>refs.map(doc),create:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>writes.push(()=>{assert(!state.has(r.path));state.set(r.path,data);}),set:(r:ReturnType<typeof ref>,data:Record<string,unknown>,options?:{merge:boolean})=>writes.push(()=>state.set(r.path,options?.merge?{...state.get(r.path),...data}:data)),update:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>writes.push(()=>state.set(r.path,{...state.get(r.path),...data}))});
  writes.forEach(write=>write());return result;
 }} as unknown as Firestore;
 return {state,db,records:[doc(ref('events','news'))],receiptReads:()=>receiptReads};
}
const extractedRelationship=Object.fromEntries(Object.entries(relationship).filter(([field])=>!['sourceId','targetId'].includes(field)));
const output=()=>({analysis:{relationships:[extractedRelationship]},model:'gpt-6-luna',responseId:'resp_test',usage:{input_tokens:3000,output_tokens:500,total_tokens:3500}});
const options={now:()=>now,deadline:now+150000,download:async()=>text};
test('routine article analysis queries only due work without rescanning completed history',async()=>{
 const f=fake();let calls=0;
 f.state.set('events/news',{...f.state.get('events/news'),newsAnalysisNextCheckAtMs:0});
 for(let i=0;i<300;i++)f.state.set(`events/old_${i}`,{...f.state.get('events/news'),newsAnalysisNextCheckAtMs:Number.MAX_SAFE_INTEGER});
 const config={...options,analyze:async()=>{calls++;return output();}};
 assert.equal((await analyzeCollectedNews(f.db,companies,sources,config)).scanned,1);
 assert.equal((await analyzeCollectedNews(f.db,companies,sources,config)).scanned,0);
 assert.equal(calls,1);
 assert.equal(f.state.get('collectors/news-article-analysis')?.afterEventId,undefined);
});

test('full article analysis persists bilingual review candidates once, never published map edges',async()=>{
 const f=fake();let calls=0;
 const config={...options,records:f.records,analyze:async()=>{calls++;return output();}};
 assert.equal((await analyzeCollectedNews(f.db,companies,sources,config)).candidates,1);
 const priorReads=f.receiptReads();
 await analyzeCollectedNews(f.db,companies,sources,config);assert.equal(calls,1);assert.equal(f.receiptReads(),priorReads);
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
 const g=fake();await analyzeCollectedNews(g.db,companies,sources,{...options,records:g.records,analyze:async()=>({...output(),analysis:{relationships:[{...extractedRelationship,targetName:'Unknown company'}]}})});
 assert(![...g.state.keys()].some(path=>path.startsWith('company_relationships/')));
 assert.equal(([...g.state.values()].find(row=>row.type==='news_analysis')!.analysis as {relationships:unknown[]}).relationships.length,1);
});

test('API uses only article and title, with names-only bilingual output and no paid search',async()=>{
 const request:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.deepEqual(JSON.parse(body.input),{title:'Headline',content:text});assert.equal(body.text.format.strict,true);const item=body.text.format.schema.properties.relationships.items;assert.equal(item.properties.sourceId,undefined);assert.equal(item.properties.targetId,undefined);assert(!item.required.includes('sourceId'));assert(!body.instructions.includes('supplied catalog'));return Response.json({status:'completed',id:'resp_test',output:[{content:[{type:'output_text',text:JSON.stringify(output().analysis)}]}]});};
 const result=await analyzeNewsArticle('Headline',text,{key:'isolated-test-key',request});assert.equal(validateNewsAnalysis(resolveNewsAnalysis(result.analysis,createNewsCompanyResolver(companies),text),text,companies).relationships.length,1);
});

test('duplicate observations in a response produce one review record',async()=>{
 const f=fake();const result=await analyzeCollectedNews(f.db,companies,sources,{...options,records:f.records,analyze:async()=>({...output(),analysis:{relationships:[relationship,{...relationship,product:'Another scope'}]}})});
 assert.equal(result.candidates,1);
 assert.equal([...f.state.keys()].filter(path=>path.startsWith('company_relationships/')).length,1);
});

test('local identity index handles localized names, explicit aliases and ticker collisions without fuzzy merging',()=>{
 const nodes:GraphNode[]=[
  ...companies,
  {id:'US:NVDA',kind:'COMPANY',order:2,name:'NVIDIA',names:{'zh-CN':'英伟达'},aliases:['NVIDIA Corporation'],symbol:'NVDA'},
  {id:'ORG:OTHER',kind:'COMPANY',order:3,name:'Other',aliases:['Arista'],symbol:'NVDA'},
 ];
 const resolve=createNewsCompanyResolver(nodes);
 assert.equal(resolve('  NVIDIA   Corporation  '),'US:NVDA');
 assert.equal(resolve('英伟达'),'US:NVDA');
 assert.equal(resolve('ｎｖｉｄｉａ'),'US:NVDA');
 assert.equal(resolve('US:NVDA'),'US:NVDA');
 assert.equal(resolve('NVDA'),'');assert.equal(resolve('Arista'),'');
 assert.equal(resolve('NVIDIA China subsidiary'),'');assert.equal(resolve('Unknown'),'');
 const spoof=resolveNewsAnalysis({relationships:[{...relationship,sourceId:'US:NVDA',targetId:'US:NVDA'}]},createNewsCompanyResolver(companies),text);
 assert.equal(spoof.relationships[0].sourceId,'US:ANET');assert.equal(spoof.relationships[0].targetId,'US:AMD');
 const self=resolveNewsAnalysis({relationships:[{...extractedRelationship,sourceName:'NVIDIA',targetName:'英伟达'}]},resolve,'NVIDIA is also called 英伟达。');
 assert.equal(self.relationships[0].sourceId,'');assert.equal(self.relationships[0].targetId,'');
 const invented=resolveNewsAnalysis({relationships:[{...extractedRelationship,sourceName:'NVIDIA',targetName:'AMD'}]},resolve,text);
 assert.equal(invented.relationships[0].sourceId,'');assert.equal(invented.relationships[0].targetId,'US:AMD');
});

test('10,000 companies do not change AI request or budget reservation; direction remains source to target',async()=>{
 const large=[...companies,...Array.from({length:10000},(_,i)=>({id:`ORG:COMPANY${i}`,name:`Company ${i}`,kind:'COMPANY' as const,order:i+2}))];
 const small=fake(),big=fake();let received:unknown[]=[];
 const analyze=async(...args:unknown[])=>{received=args;return {...output(),analysis:{relationships:[{...extractedRelationship,type:'SUPPLIER_OF'}]}};};
 await analyzeCollectedNews(small.db,companies,sources,{...options,records:small.records,analyze});
 await analyzeCollectedNews(big.db,large,sources,{...options,records:big.records,analyze});
 assert.deepEqual(received,['Arista and AMD announce partnership',text]);
 const receipt=(state:typeof big.state)=>[...state.values()].find(row=>row.type==='news_analysis')!;
 assert.equal(receipt(small.state).reservationMicros,receipt(big.state).reservationMicros);
 const r=[...big.state.entries()].find(([path])=>path.startsWith('company_relationships/'))![1];
 assert.equal(r.source,'US:ANET');assert.equal(r.target,'US:AMD');assert.equal(r.type,'SUPPLIER_OF');
});

test('ambiguous names are retained for review without producing linked candidates',async()=>{
 const f=fake();const colliding=[...companies,{id:'ORG:ARISTA',name:'Arista',kind:'COMPANY' as const,order:2}];
 await analyzeCollectedNews(f.db,colliding,sources,{...options,records:f.records,analyze:async()=>output()});
 assert(![...f.state.keys()].some(path=>path.startsWith('company_relationships/')));
 const receipt=[...f.state.values()].find(row=>row.type==='news_analysis')!;
 const r=(receipt.analysis as {relationships:NewsRelationship[]}).relationships[0];
 assert.equal(r.sourceName,'Arista');assert.equal(r.sourceId,'');assert.equal(r.targetId,'US:AMD');
});

test('existing version-one receipt is reused without another provider charge',async()=>{
 const f=fake();let calls=0;
 await analyzeCollectedNews(f.db,companies,sources,{...options,records:f.records,analyze:async()=>{calls++;return output();}});
 const receipt=[...f.state.values()].find(row=>row.type==='news_analysis')!;receipt.extractorVersion=1;
 const result=await analyzeCollectedNews(f.db,companies,sources,{...options,records:f.records,analyze:async()=>{calls++;return output();}});
 assert.equal(calls,1);assert.equal(result.cached,1);
});

test('companies named only in a headline resolve locally while evidence must remain in the body',async()=>{
 const f=fake();const body='The companies announced a partnership to develop Ethernet networking for AI systems. '+ 'The products are planned for next year. '.repeat(5);
 const result=await analyzeCollectedNews(f.db,companies,sources,{...options,records:f.records,download:async()=>body,analyze:async()=>({...output(),analysis:{relationships:[{...extractedRelationship,evidence:'The companies announced a partnership to develop Ethernet networking for AI systems.'}]}})});
 assert.equal(result.candidates,1);
 const candidate=[...f.state.entries()].find(([path])=>path.startsWith('company_relationships/'))![1];assert.equal(candidate.source,'US:ANET');assert.equal(candidate.target,'US:AMD');
 assert.throws(()=>validateNewsAnalysis({relationships:[relationship]},body,companies),/evidence is absent/);
});
