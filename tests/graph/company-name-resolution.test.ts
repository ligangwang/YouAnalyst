import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { reviewCompanyIdentity,getNameResolution,listNameResolutions,searchIdentityCandidates,parseIdentityAction } from '../../src/lib/market-companies/name-resolution';
import { nameResolutionResponse } from '../../src/lib/market-companies/name-resolution-http';
import { articleHash,createNewsCompanyResolver,type NewsRelationship } from '../../src/lib/intelligence/collectors/news-analysis';
const content='Arista Networks and AMD announced a partnership to develop Ethernet networking for AI systems.';
const receiptId='news_analysis_'+articleHash('https://investors.arista.com/news/test'),sourceId='company_news_'+articleHash('source');
const relationship:NewsRelationship={sourceId:'',targetId:'US:AMD',sourceName:'Arista Networks',targetName:'AMD',type:'PARTNER_OF',state:'ANNOUNCED',summaryEn:'A planned networking partnership.',summaryZh:'计划开展网络合作。',evidence:content,product:'Networking',eventDate:null,confidence:.9};
const input={action:'propose',receiptId,contentHash:articleHash(content),relationshipIndex:0,side:'source',expectedName:'Arista Networks',companyId:'US:ANET'};
function fake(){
 const state=new Map<string,Record<string,unknown>>([
  ['events/'+sourceId,{type:'company_news',sourceType:'company_ir',url:'https://investors.arista.com/news/test',title:'Networking partnership',publication_date:'2026-10-13',newsAnalysis:{receiptId}}],
  ['events/'+receiptId,{type:'news_analysis',status:'complete',content,contentHash:articleHash(content),sourceEventId:sourceId,sourceUrl:'https://investors.arista.com/news/test',title:'Networking partnership',analysis:{relationships:[{...relationship}]}}],
  ['companies/US:ANET',{status:'PUBLISHED',name:'Arista',names:{'zh-CN':'阿里斯塔'},aliases:[],country:'US',website:'https://www.arista.com/',symbol:'ANET',symbolLower:'anet',searchPrefixes:['arista','arista networks'],exchange:'NASDAQ'}],
  ['companies/US:AMD',{status:'PUBLISHED',name:'AMD',symbol:'AMD',aliases:[]}],
  ['companies/US:HIDDEN',{status:'DRAFT',name:'Arista',symbol:'HIDDEN',searchPrefixes:['arista']}],
 ]);
 const ref=(collection:string,id:string)=>({id,path:collection+'/'+id,get:async()=>doc(ref(collection,id))});
 const doc=(r:ReturnType<typeof ref>)=>({id:r.id,ref:r,exists:state.has(r.path),data:()=>state.get(r.path)});
 function query(collection:string,filters:{field:unknown;op:string;value:unknown}[]=[],lower='',upper='',after='',limit=1000):unknown{
  return {doc:(id:string)=>ref(collection,id),where:(field:string,op:string,value:unknown)=>query(collection,[...filters,{field,op,value}],lower,upper,after,limit),orderBy:()=>query(collection,filters,lower,upper,after,limit),startAt:(value:string)=>query(collection,filters,value,upper,after,limit),endBefore:(value:string)=>query(collection,filters,lower,value,after,limit),startAfter:(value:string)=>query(collection,filters,lower,upper,value,limit),limit:(value:number)=>query(collection,filters,lower,upper,after,value),get:async()=>{
   const docs=[...state.entries()].filter(([path,d])=>path.startsWith(collection+'/')&&filters.every(f=>f.op==='array-contains'?Array.isArray(d[String(f.field)])&&(d[String(f.field)] as unknown[]).includes(f.value):d[String(f.field)]===f.value)).map(([path])=>doc(ref(collection,path.slice(collection.length+1)))).filter(d=>(!lower||d.id>=lower)&&(!upper||d.id<upper)&&(!after||d.id>after)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit);
   return {docs,size:docs.length};
  }};
 }
 const db={collection:(name:string)=>query(name),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{
  const writes:(()=>void)[]=[];
  const patch=(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>{const old={...state.get(r.path)};for(const [field,value] of Object.entries(data)){const parts=field.split('.');let target=old;for(const p of parts.slice(0,-1)){target[p]={...(target[p] as Record<string,unknown>??{})};target=target[p] as Record<string,unknown>;}target[parts.at(-1)!]=value;}state.set(r.path,old);};
  const result=await fn({get:async(r:ReturnType<typeof ref>)=>doc(r),update:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>writes.push(()=>patch(r,data)),set:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>writes.push(()=>patch(r,data)),create:(r:ReturnType<typeof ref>,data:Record<string,unknown>)=>writes.push(()=>{assert(!state.has(r.path));state.set(r.path,data);})});writes.forEach(w=>w());return result;
 }} as unknown as Firestore;
 return {state,db};
}
const user={uid:'user-one',admin:false},admin={uid:'admin-one',admin:true};
test('user proposals are article-specific, private to their proposer and never teach aliases',async()=>{
 const f=fake();await reviewCompanyIdentity(f.db,input,user);
 assert.deepEqual(f.state.get('companies/US:ANET')!.aliases,[]);
 assert.equal((f.state.get('events/'+receiptId)!.analysis as {relationships:NewsRelationship[]}).relationships[0].sourceId,'');
 assert(![...f.state.keys()].some(path=>path.startsWith('company_relationships/')));
 assert.equal((await getNameResolution(f.db,'news-'+sourceId,user.uid,false)).receipt!.proposals.length,1);
 assert.equal((await getNameResolution(f.db,'news-'+sourceId,'different-user',false)).receipt!.proposals.length,0);
 assert.equal((await getNameResolution(f.db,'news-'+sourceId,admin.uid,true)).receipt!.proposals.length,1);
 await assert.rejects(reviewCompanyIdentity(f.db,{...input,action:'approve'},user),/Administrator/);
 assert.throws(()=>parseIdentityAction({...input,reusableAlias:true,evidenceUrl:'https://example.com/'}),/cannot approve aliases/);
});
test('admin confirms an article without global learning and keeps its relationship unpublished',async()=>{
 const f=fake();await reviewCompanyIdentity(f.db,input,user);
 const proposal=(f.state.get('events/'+receiptId)!.identityProposals as {id:string}[])[0];
 await reviewCompanyIdentity(f.db,{...input,action:'approve',proposalId:proposal.id},admin,'2026-10-13T12:00:00Z');
 assert.deepEqual(f.state.get('companies/US:ANET')!.aliases,[]);
 const r=(f.state.get('events/'+receiptId)!.analysis as {relationships:NewsRelationship[]}).relationships[0];assert.equal(r.sourceId,'US:ANET');
 const candidate=[...f.state.entries()].find(([path])=>path.startsWith('company_relationships/'))![1];assert.equal(candidate.status,'NEEDS_REVIEW');assert.equal(candidate.commercialStatus,'ANNOUNCED');
 assert.equal((f.state.get('events/'+sourceId)!.newsAnalysis as {candidateCount:number}).candidateCount,1);
 await assert.rejects(reviewCompanyIdentity(f.db,{...input,action:'approve',proposalId:proposal.id},admin),/already reviewed/);
});
test('evidence-backed admin aliases update existing canonical records and future local matching',async()=>{
 const f=fake();await reviewCompanyIdentity(f.db,{...input,action:'approve',reusableAlias:true,evidenceUrl:'https://www.arista.com/company'},admin,'2026-10-13T12:00:00Z');
 const c=f.state.get('companies/US:ANET')!;assert.equal(c.name,'Arista');assert.deepEqual(c.aliases,['Arista Networks']);assert.deepEqual(c.aliasKeys,['arista networks']);
 const audit=(c.aliasReviews as Record<string,Record<string,unknown>>)[articleHash('arista networks')];assert.equal(audit.approvedBy,'admin-one');assert.equal(audit.evidenceUrl,'https://www.arista.com/company');
 const resolve=createNewsCompanyResolver([{id:'US:ANET',kind:'COMPANY',order:0,name:String(c.name),aliases:c.aliases as string[]}]);assert.equal(resolve('ARISTA NETWORKS'),'US:ANET');
 const collision=createNewsCompanyResolver([{id:'US:ANET',kind:'COMPANY',order:0,aliases:c.aliases as string[]},{id:'ORG:OTHER',kind:'COMPANY',order:1,aliases:['Arista Networks']}]);assert.equal(collision('Arista Networks'),'');
 assert(f.state.has('directory_syncs/company_names'));
 assert.deepEqual([...new Set([...f.state.keys()].map(path=>path.split('/')[0]))].sort(),['companies','company_relationships','directory_syncs','events']);
 assert.equal((await searchIdentityCandidates(f.db,'ARISTA NETWORKS')).items[0].id,'US:ANET');
});
test('stale source, hidden company, conflicting match, self-edge and unsupported evidence are rejected atomically',async()=>{
 const cases=[
  (f:ReturnType<typeof fake>)=>{f.state.get('events/'+sourceId)!.title='Edited';},
  (f:ReturnType<typeof fake>)=>{f.state.get('companies/US:ANET')!.status='DRAFT';},
  (f:ReturnType<typeof fake>)=>{(f.state.get('events/'+receiptId)!.analysis as {relationships:NewsRelationship[]}).relationships[0].sourceId='US:OTHER';},
  (f:ReturnType<typeof fake>)=>{(f.state.get('events/'+receiptId)!.analysis as {relationships:NewsRelationship[]}).relationships[0].targetId='US:ANET';},
  (f:ReturnType<typeof fake>)=>{(f.state.get('events/'+receiptId)!.analysis as {relationships:NewsRelationship[]}).relationships[0].evidence='An invented agreement with no original evidence.';},
 ];
 for(const mutate of cases){const f=fake();mutate(f);const before=JSON.stringify([...f.state]);await assert.rejects(reviewCompanyIdentity(f.db,{...input,action:'approve',reusableAlias:true,evidenceUrl:'https://www.arista.com/company'},admin));assert.equal(JSON.stringify([...f.state]),before);}
 assert.throws(()=>parseIdentityAction({...input,action:'approve',reusableAlias:true}),/require source/);
 assert.throws(()=>parseIdentityAction({...input,action:'approve',reusableAlias:true,evidenceUrl:'javascript:alert(1)'}),/Invalid/);
 const f=fake();await assert.rejects(reviewCompanyIdentity(f.db,{...input,action:'approve',contentHash:'0'.repeat(64)},admin),/Article changed/);
});
test('rejection keeps identities unresolved; candidate search omits hidden companies and queue lists pending work',async()=>{
 const f=fake();await reviewCompanyIdentity(f.db,input,user);
 const proposal=(f.state.get('events/'+receiptId)!.identityProposals as {id:string}[])[0];await reviewCompanyIdentity(f.db,{...input,action:'reject',proposalId:proposal.id},admin);
 assert.equal((f.state.get('events/'+receiptId)!.identityProposals as {status:string}[])[0].status,'REJECTED');assert.deepEqual(f.state.get('companies/US:ANET')!.aliases,[]);
 const matches=await searchIdentityCandidates(f.db,'arista');assert.equal(matches.items.length,1);assert.equal(matches.items[0].country,'US');assert.equal(matches.items[0].website,'https://www.arista.com/');
 assert.equal((await listNameResolutions(f.db,admin.uid)).receipts.length,1);
 f.state.get('companies/US:ANET')!.searchPrefixes=['arista'];assert.equal((await searchIdentityCandidates(f.db,'Arista Networks')).items[0].id,'US:ANET');
});
test('HTTP authenticates and authorizes before database reads, bounds input and hides backend errors',async()=>{
 let reads=0;const db=()=>{reads++;throw new Error('secret backend detail');};
 const post=(body:unknown)=>new Request('https://youanalyst.com/api/company-name-resolution',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const anon=await nameResolutionResponse(post(input),{authenticate:async()=>null,db});assert.equal(anon.status,401);assert.equal(reads,0);
 const denied=await nameResolutionResponse(post({...input,action:'approve'}),{authenticate:async()=>user,db});assert.equal(denied.status,403);assert.equal(reads,0);
 const queue=await nameResolutionResponse(new Request('https://youanalyst.com/api/company-name-resolution'),{authenticate:async()=>user,db});assert.equal(queue.status,403);assert.equal(reads,0);
 const oversized=await nameResolutionResponse(post({text:'x'.repeat(5000)}),{authenticate:async()=>user,db});assert.equal(oversized.status,413);assert.equal(reads,0);
 const unavailable=await nameResolutionResponse(post(input),{authenticate:async()=>user,db});assert.equal(unavailable.status,503);assert(!JSON.stringify(await unavailable.json()).includes('secret'));assert.equal(unavailable.headers.get('Cache-Control'),'private, no-store');
});

test('article identity confirmation accepts a name in the original headline without fabricating body evidence',async()=>{
 const f=fake(),body='The companies announced a partnership to develop Ethernet networking for AI systems.';
 const receipt=f.state.get('events/'+receiptId)!;receipt.content=body;receipt.contentHash=articleHash(body);receipt.title='Arista Networks and AMD announce partnership';f.state.get('events/'+sourceId)!.title=receipt.title;
 (receipt.analysis as {relationships:NewsRelationship[]}).relationships[0].evidence=body;
 await reviewCompanyIdentity(f.db,{...input,action:'approve',contentHash:articleHash(body)},admin);
 const updated=f.state.get('events/'+receiptId)!;assert.equal((updated.analysis as {relationships:NewsRelationship[]}).relationships[0].sourceId,'US:ANET');
});
