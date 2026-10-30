import * as demandHelpers from '../../src/lib/peer-comparison/price-demand';
import test from 'node:test';
import {isValidElement} from 'react';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {FieldPath} from 'firebase-admin/firestore';
import {withCompanyPageReads} from '../../src/lib/local-cache/company-page-scope';
import {enableCompanyDirectory,companyDirectoryEnabled,registerCompanySource,withLiveCompanyReads} from '../../src/lib/local-cache/company-directory';
import {readCompanyLookup} from '../../src/lib/company-lookup-cache';
import {loadCompanyDocuments} from '../../src/lib/company-document-cache';
import {lookupCompanyRoute} from '../../src/lib/market-companies/slug-lookup';
import {closeLocalCaches} from '../../src/lib/local-cache/watch';
import {loadCompanyAnnouncementSources} from '../../src/lib/events/company-announcements';
import {loadPeerPrices} from '../../src/lib/peer-comparison/price-cache';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {loadCompanyNeighborhood} from '../../src/lib/knowledge-graph/company-neighborhood';
import {companyResearchGraph} from '../../src/lib/knowledge-graph/company-research-projection';
import {buildCompanyResearch} from '../../src/lib/company-research';
import {legacyCatalog} from '../helpers/theme-catalog';
import {traceCompanyPage,timeCompanyPhase,timeCompanyPhaseSync} from '../../src/lib/company-page-timing';

function fixture(hold?:(collection:string,steps:{method:string;args:unknown[]}[])=>boolean){
 const rows=new Map<string,Record<string,unknown>>([
  ['companies/US:SMALL',{slug:'small-example',name:'Small',symbol:'SMALL'}],
  ['company_fundamentals/US:SMALL',{value:{fetchedAt:'2026-10-24',revenue:17}}],
 ]);
 const listeners=new Set<()=>void>();let files=0,opens=0,gets=0;
 const pending=new Set<()=>void>(),readDocs=new Set<string>();
 function source(collection:string,id?:string,steps:{method:string;args:unknown[]}[]=[]){
  const key=JSON.stringify([collection,id,steps.map(s=>({...s,args:s.args.map(a=>a instanceof FieldPath?'__name__':a)}))]);
  const snapshot=(docId:string)=>({id:docId,ref:source(collection,docId),exists:rows.has(collection+'/'+docId),data:()=>{readDocs.add(collection+'/'+docId);return structuredClone(rows.get(collection+'/'+docId));},get:(field:string)=>rows.get(collection+'/'+docId)?.[field]});
  const read=()=>{
   if(id!==undefined)return snapshot(id);
   let ids=[...rows.keys()].filter(k=>k.startsWith(collection+'/')).map(k=>k.slice(collection.length+1));
   for(const step of steps){
    if(step.method==='where'){
     const [field,op,wanted]=step.args;
     ids=ids.filter(id=>{const actual=field instanceof FieldPath?id:rows.get(collection+'/'+id)?.[String(field)];return op==='in'?(wanted as unknown[]).includes(actual):op==='>='?String(actual)>=String(wanted):op==='<='?String(actual)<=String(wanted):actual===wanted;});
    }
    if(step.method==='orderBy')ids.sort((a,b)=>a.localeCompare(b)*(step.args[1]==='desc'?-1:1));
    if(step.method==='limit')ids=ids.slice(0,Number(step.args[0]));
   }
   return {docs:ids.map(snapshot)};
  };
  const value={path:collection+(id?'/'+id:''),id,isEqual:(other:{key:string})=>other.key===key,key,
   doc:(id:string)=>source(collection,id),
   where:(...args:unknown[])=>source(collection,undefined,[...steps,{method:'where',args}]),
   limit:(n:number)=>source(collection,undefined,[...steps,{method:'limit',args:[n]}]),
   orderBy:(...args:unknown[])=>source(collection,undefined,[...steps,{method:'orderBy',args}]),
   select:(...args:unknown[])=>source(collection,undefined,[...steps,{method:'select',args}]),
   get:async()=>{gets++;return read();},
   onSnapshot:(next:(snapshot:unknown)=>void)=>{opens++;const push=()=>next(read());listeners.add(push);if(hold?.(collection,steps))pending.add(push);else queueMicrotask(push);return ()=>{listeners.delete(push);pending.delete(push);};},
  };
  registerCompanySource(value,id,steps,collection as 'companies');return value;
 }
 const db={collection:(name:string)=>source(name)} as unknown as Firestore;
 enableCompanyDirectory(db,db,{file:async collection=>{files++;return new Map([...rows].filter(([key])=>key.startsWith(collection+'/')).map(([key,value])=>[key.split('/')[1],value]));},price:{years:async()=>[2026],file:async()=>{files++;throw Error('price partition requested');}},sync:false});
 return {db,rows,readDocs,release:()=>{for(const push of pending)push();pending.clear();},push:()=>listeners.forEach(push=>push()),counts:()=>({files,opens,gets})};
}

test('cold company routes and financial documents never download whole snapshots, and visitors share push subscriptions',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const read=()=>withCompanyPageReads(async()=>{
  const route=await lookupCompanyRoute('small-example',f.db);
  const [doc]=await loadCompanyDocuments(f.db,'company_fundamentals',['US:SMALL']);
  return {route,value:doc.get('value')};
 });
 const results=await Promise.all(Array.from({length:20},read));
 assert.equal(results[0].route?.id,'US:SMALL');assert.deepEqual(results[0].value,{fetchedAt:'2026-10-24',revenue:17});
 assert.deepEqual(f.counts(),{files:0,opens:2,gets:0});
 f.rows.set('company_fundamentals/US:SMALL',{value:{revenue:23}});f.push();
 assert.deepEqual((await read()).value,{revenue:23});assert.equal(f.counts().opens,2);
 f.rows.set('companies/US:SMALL',{slug:'small-example',isDeleted:true});f.push();
 assert.equal((await read()).route,null);
 assert.equal(f.counts().files,0);
});

test('peer prices retain bounded live-query fallback before snapshot readiness',async t=>{
 t.after(closeLocalCaches);const f=fixture(),previous=process.env.PRICE_SNAPSHOT_READY;
 process.env.PRICE_SNAPSHOT_READY='0';t.after(()=>{if(previous===undefined)delete process.env.PRICE_SNAPSHOT_READY;else process.env.PRICE_SNAPSHOT_READY=previous;});
 for(let day=1;day<=20;day++)f.rows.set(`eod_prices/US_SMALL_2026-10-${String(day).padStart(2,'0')}`,{close:day});
 f.rows.set('eod_prices/US_OTHER_2026-10-20',{close:999});
 const read=()=>withCompanyPageReads(()=>loadPeerPrices(f.db,'US:SMALL','US','2026-10-19'));
 const results=await Promise.all(Array.from({length:20},read));
 assert.deepEqual(results[0].map(row=>row.close),[19,18,17,16,15,14,13,12,11,10,9,8]);
 assert.deepEqual(f.counts(),{files:0,opens:1,gets:0});
 f.rows.set('eod_prices/US_SMALL_2026-10-19',{close:123});f.push();
 assert.equal((await read())[0].close,123);assert.equal(f.counts().opens,1);
 await loadPeerPrices(f.db,'US:SMALL','US','2026-10-19');
 assert.equal(f.counts().files,0,'unready snapshots retain the bounded query fallback');
});

test('public graph HTTP reads retain the targeted cache boundary for cold company charts',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const root=globalThis as typeof globalThis&{__graphRouteRead?:(theme:string)=>Promise<unknown>};
 const previous=root.__graphRouteRead;
 t.after(()=>{if(previous)root.__graphRouteRead=previous;else delete root.__graphRouteRead;});
 // Replace only the graph/catalog data dependencies; execute the real bundled
 // HTTP route and its async cache scope against the enabled file directory.
 const result=await build({entryPoints:['src/app/api/knowledge-graph/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{
  name:'graph-route-fixture',setup(plugin){
   plugin.onLoad({filter:/company-themes[\\/]graph-service\.ts$/},()=>({contents:'export const loadThemeGraph=async theme=>globalThis.__graphRouteRead(theme);',loader:'js'}));
   plugin.onLoad({filter:/company-themes[\\/]catalog\.ts$/},()=>({contents:`export const loadThemeCatalog=async()=>${JSON.stringify(legacyCatalog)};`,loader:'js'}));
  }
 }]});
 const evaluated={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),evaluated,evaluated.exports);
 const {GET}=evaluated.exports as {GET:(request:Request)=>Promise<Response>};
 root.__graphRouteRead=async theme=>{
  const company=await readCompanyLookup(f.db,f.db.collection('companies').doc('US:SMALL'));
  const [financials]=await loadCompanyDocuments(f.db,'company_fundamentals',['US:SMALL']);
  return {theme,company:company.get('name'),value:financials.get('value')};
 };
 const read=()=>GET(new Request('https://example.test/api/knowledge-graph?theme=ai'));
 const responses=await Promise.all(Array.from({length:20},read));
 assert(responses.every(response=>response.status===200));
 assert.deepEqual(await responses[0].json(),{theme:'ai',company:'Small',value:{fetchedAt:'2026-10-24',revenue:17}});
 assert.equal(responses[0].headers.get('Cache-Control'),'no-store');
 assert.equal(responses[0].headers.get('X-Graph-Storage'),'company_relationships');
 assert.deepEqual(f.counts(),{files:0,opens:2,gets:0});
 f.rows.set('company_fundamentals/US:SMALL',{value:{revenue:23}});f.push();
 assert.equal((await(await read()).json()).value.revenue,23);
 assert.equal((await GET(new Request('https://example.test/api/knowledge-graph?theme=missing'))).status,404);
 root.__graphRouteRead=async()=>{throw Error('source unavailable');};
 assert.equal((await read()).status,503);
 await readCompanyLookup(f.db,f.db.collection('companies').doc('US:SMALL'));
 assert.equal(f.counts().files,1,'the scope restores the existing bulk policy after responses and errors');
});

test('intelligence and covered search HTTP reads share targeted data without cold market files',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const root=globalThis as typeof globalThis&{__httpScopeRead?:()=>Promise<unknown>};
 const previous=root.__httpScopeRead;t.after(()=>{if(previous)root.__httpScopeRead=previous;else delete root.__httpScopeRead;});
 root.__httpScopeRead=async()=>{
  const company=await readCompanyLookup(f.db,f.db.collection('companies').doc('US:SMALL'));
  const [financials]=await loadCompanyDocuments(f.db,'company_fundamentals',['US:SMALL']);
  return {nodes:[{id:'US:SMALL',kind:'COMPANY',name:company.get('name'),symbol:'SMALL',market:'US',marketCap:financials.get('value')},
   {id:'US:NEIGHBOR',kind:'COMPANY',name:'Relationship-only neighbor',symbol:'NEIGHBOR',market:'US'}],edges:[{source:'US:NEIGHBOR',target:'US:SMALL'}]};
 };
 const routes=[] as ((request:Request&{nextUrl:URL})=>Promise<Response>)[];
 for(const entry of ['src/app/api/intelligence/route.ts','src/app/api/tickers/search/route.ts']){
  const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{
   name:'http-scope-fixture',setup(plugin){
    plugin.onLoad({filter:/intelligence[\\/]service\.ts$/},()=>({contents:'export const loadIntelligenceUniverse=()=>globalThis.__httpScopeRead();export const loadCompanyIntelligenceSnapshot=()=>globalThis.__httpScopeRead();',loader:'js'}));
    plugin.onLoad({filter:/company-themes[\\/]service\.ts$/},()=>({contents:'export const loadCollectionUniverse=()=>globalThis.__httpScopeRead();',loader:'js'}));
    plugin.onLoad({filter:/company-themes[\\/]catalog\.ts$/},()=>({contents:`export const loadThemeCatalog=async()=>${JSON.stringify(legacyCatalog)};`,loader:'js'}));
    plugin.onLoad({filter:/firebase[\\/]admin\.ts$/},()=>({contents:'export const getAdminFirestore=()=>({});',loader:'js'}));
    // Exercise the real HTTP boundary and real entity cache scope; the change
    // cache's data source is deliberately cold for every concurrent request.
    plugin.onLoad({filter:/lib[\\/]change-cache\.ts$/},()=>({contents:'export const changeCached=(_db,_key,_collections,read)=>read();',loader:'js'}));
   }
  }]});
  const evaluated={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),evaluated,evaluated.exports);
  routes.push((evaluated.exports as {GET:typeof routes[number]}).GET);
 }
 const request=(path:string)=>Object.assign(new Request('https://example.test'+path),{nextUrl:new URL('https://example.test'+path)});
 const paths=['/api/intelligence?theme=ai&section=universe','/api/intelligence?theme=ai','/api/tickers/search?scope=covered&q=neighbor'];
 const responses=await Promise.all(Array.from({length:20},()=>Promise.all(paths.map((path,i)=>routes[i===2?1:0](request(path))))));
 assert(responses.flat().every(response=>response.status===200));
 for(const response of responses[0].slice(0,2)){
  const graph=await response.json();assert.equal(graph.nodes.length,2);assert.equal(graph.edges.length,1);assert.equal(graph.nodes[0].marketCap.revenue,17);
 }
 const search=await responses[0][2].json();assert.equal(search.total,2);assert.equal(search.items[0].id,'US:NEIGHBOR');
 assert.deepEqual(f.counts(),{files:0,opens:2,gets:0});
 assert.equal((await routes[0](request('/api/intelligence?theme=missing'))).status,404);
 assert.equal((await routes[0](request('/api/intelligence?before=bad'))).status,400);
 root.__httpScopeRead=async()=>{throw Error('unavailable');};
 assert.equal((await routes[0](request(paths[0]))).status,503);
 await readCompanyLookup(f.db,f.db.collection('companies').doc('US:SMALL'));
 assert.equal(f.counts().files,1,'HTTP scopes restore bulk policy after success and failure');
});

test('page cache scope does not change bulk readers, leak after rejection or cache authoritative reads',async t=>{
 t.after(closeLocalCaches);const f=fixture(),ref=f.db.collection('companies').doc('US:SMALL');
 await assert.rejects(withCompanyPageReads(async()=>{assert.equal(companyDirectoryEnabled(f.db),false);assert.equal(companyDirectoryEnabled(f.db,'eod_prices'),true);assert.equal(companyDirectoryEnabled(f.db,'instruments'),true);throw Error('render failure');}),/render failure/);
 assert.equal(companyDirectoryEnabled(f.db),true);
 await withCompanyPageReads(()=>withLiveCompanyReads(()=>readCompanyLookup(f.db,ref)));
 assert.equal(f.counts().gets,1);assert.equal(f.counts().opens,0);
 await readCompanyLookup(f.db,ref);
 assert.equal(f.counts().files,1,'bulk directory policy is unchanged outside company pages');
 const doc=await withCompanyPageReads(()=>readCompanyLookup(f.db,ref));
 assert.equal(doc.get('name'),'Small');assert.equal(f.counts().opens,1);
});

test('announcement source approval reads only its company, shares the push cache and applies withdrawals',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const source={id:'small-ir',companyId:'US:SMALL',name:'Small IR',url:'https://ir.smallcompany.com/rss.xml',allowedHosts:['ir.smallcompany.com'],pollMs:3600000,status:'PUBLISHED',reviewedAt:'2026-10-06'};
 const company={name:'Small',status:'DIRECTORY',onboarding:{status:'SUPPORTED'},themeMemberships:{ai:{status:'PUBLISHED'}},newsSources:[source]};
 f.rows.set('investment_themes/technology',{status:'PUBLISHED',parentId:null,names:{en:'Technology','zh-CN':'Technology'},order:0});
 f.rows.set('investment_themes/ai',{status:'PUBLISHED',parentId:'technology',names:{en:'AI','zh-CN':'AI'},order:0});
 f.rows.set('companies/US:SMALL',company);
 // An unrelated invalid source cannot block this company's announcements.
 f.rows.set('companies/US:OTHER',{...company,newsSources:[{...source,companyId:'US:OTHER',url:'http://unapproved.invalid'}]});
 const read=()=>loadCompanyAnnouncementSources(f.db,'US:SMALL');
 const results=await Promise.all(Array.from({length:20},read));
 assert.equal(results[0][0]?.id,'small-ir');
 assert.deepEqual(f.counts(),{files:0,opens:1,gets:0});
 f.rows.set('companies/US:SMALL',{...company,newsSources:[{...source,status:'WITHDRAWN'}]});f.push();
 assert.deepEqual(await read(),[]);
 f.rows.set('companies/US:SMALL',{...company,onboarding:{status:'BLOCKED'}});f.push();
 assert.deepEqual(await read(),[]);
 f.rows.set('companies/US:SMALL',{...company,onboarding:{status:'QUEUED'}});f.push();
 assert.deepEqual(await read(),[],'queued onboarding cannot authorize a source');
 f.rows.set('companies/US:SMALL',{...company,isDeleted:true});f.push();assert.deepEqual(await read(),[]);
 f.rows.delete('companies/US:SMALL');f.push();assert.deepEqual(await read(),[]);
 assert.deepEqual(f.counts(),{files:0,opens:1,gets:0});
});


test('an unenrolled company reads only its endpoints; graph-only neighbors retain incoming sources and withdrawals',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const membership={status:'PUBLISHED',stageIds:[],stages:[],memberships:[],sources:[],order:0,asOf:'2026-10-24'};
 const company={name:'Small',symbol:'SMALL',status:'DIRECTORY',active:true,predictionSupported:true};
 f.rows.set('companies/US:SMALL',company);
 f.rows.set('companies/US:SUPPLIER',{name:'Supplier',symbol:'SUPPLIER',status:'PUBLISHED',inGraph:membership});
 const edge={source:'US:SUPPLIER',target:'US:SMALL',type:'SUPPLIER_OF',status:'PUBLISHED',evidence:[{id:'filing',title:'Filing',url:'https://www.sec.gov/Archives/filing'}]};
 f.rows.set('company_relationships/supplier',edge);
 f.rows.set('company_relationships/hidden',{...edge,status:'WITHDRAWN'});
 f.rows.set('company_relationships/other-theme',{...edge,themeIds:['energy']});
 f.rows.set('company_relationships/deleted',{...edge,isDeleted:true});
 const read=()=>withCompanyPageReads(()=>loadCompanyNeighborhood(f.db,'US:SMALL',company));
 const results=await Promise.all(Array.from({length:20},read));
 const research=buildCompanyResearch('SMALL',[company],companyResearchGraph(results[0]));
 assert.equal(research.inMap,true,'direct enrollment is not necessary for published graph neighbors');
 assert.equal(research.connections.length,1);assert.equal(research.connections[0].label,'Supplier supplies Small');
 assert.equal(research.connections[0].evidence[0].filingUrl,edge.evidence[0].url);
 assert.deepEqual(f.counts(),{files:0,opens:3,gets:0},'two endpoint queries and one neighbor; no target, directory or financial reread');
 f.rows.set('company_relationships/supplier',{...edge,status:'WITHDRAWN'});f.push();
 assert.equal((await read()).nodes.some(node=>node.id==='US:SMALL'),false,'withdrawal removes relationship-only membership');
});

test('an uncovered company does not read global graph, neighbors or valuations',async t=>{
 t.after(closeLocalCaches);const f=fixture(),company={name:'Small',symbol:'SMALL',status:'DIRECTORY'};
 const graph=await withCompanyPageReads(()=>loadCompanyNeighborhood(f.db,'US:SMALL',company));
 assert.deepEqual(graph.nodes,[]);assert.deepEqual(graph.relationships,[]);
 assert.deepEqual(f.counts(),{files:0,opens:2,gets:0});
});

test('cold NVIDIA reads only its neighborhood and preserves exact-key editorial withdrawals',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const member={status:'PUBLISHED',stageIds:[],stages:[],memberships:[],sources:[],order:0,asOf:'2026-10-24'};
 const company={name:'NVIDIA',symbol:'NVDA',status:'PUBLISHED',inGraph:member};
 f.rows.set('companies/US:NVDA',company);
 for(const id of ['TSM','MU'])f.rows.set(`companies/US:${id}`,{name:id,status:'DIRECTORY'});
 for(let i=0;i<1000;i++)f.rows.set(`companies/US:UNRELATED${i}`,{name:'Unrelated',status:'PUBLISHED',inGraph:member});
 const read=()=>withCompanyPageReads(()=>loadCompanyNeighborhood(f.db,'US:NVDA',company));
 const graphs=await Promise.all(Array.from({length:20},read));
 assert.deepEqual(graphs[0].relationships.filter(edge=>edge.type==='SUPPLIER_OF').map(edge=>edge.source).sort(),['ORG:SAMSUNG-ELECTRONICS','US:MU','US:SKHY','US:TSM']);
 assert.deepEqual(f.counts(),{files:0,opens:5,gets:0},'endpoint queries, exact editorial keys, bounded neighbors and editorial identity batches');
 assert(![...f.readDocs].some(path=>path.includes('UNRELATED')||path.startsWith('company_fundamentals/')));
 f.rows.set('company_relationships/US:TSM__SUPPLIER_OF__US:NVDA',{source:'US:OTHER',target:'US:ELSEWHERE',type:'SUPPLIER_OF',status:'WITHDRAWN'});
 f.rows.set('companies/US:SKHY',{name:'Hidden SK hynix',status:'DRAFT'});f.push();
 const updated=await read();
 assert(!updated.relationships.some(edge=>edge.source==='US:TSM'||edge.source==='US:SKHY'));
 assert(!updated.nodes.some(node=>['US:OTHER','US:ELSEWHERE','US:SKHY'].includes(node.id)));
 assert.equal(f.counts().opens,5,'corrections reuse existing listeners');
 f.rows.set('companies/ORG:SAMSUNG-ELECTRONICS',{name:'Samsung',status:'DIRECTORY',isDeleted:true});f.push();
 const deleted=await read();assert(!deleted.nodes.some(node=>node.id==='ORG:SAMSUNG-ELECTRONICS'));
 assert(!deleted.relationships.some(edge=>edge.source==='ORG:SAMSUNG-ELECTRONICS'),'tombstones cannot resurrect synthetic suppliers');
});

test('an editorial supplier does not load the other NVIDIA suppliers and respects inverse withdrawals',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const member={status:'PUBLISHED',stageIds:[],stages:[],memberships:[],sources:[],order:0,asOf:'2026-10-24'};
 const company={name:'TSMC',status:'DIRECTORY'};
 f.rows.set('companies/US:NVDA',{name:'NVIDIA',status:'PUBLISHED',inGraph:member});
 const read=()=>withCompanyPageReads(()=>loadCompanyNeighborhood(f.db,'US:TSM',company));
 const graph=await read();assert.equal(graph.relationships.filter(edge=>edge.type==='SUPPLIER_OF').length,1);
 assert.deepEqual([...f.readDocs].filter(path=>path.startsWith('companies/')),['companies/US:NVDA']);
 assert.deepEqual(graph.nodes.filter(node=>node.kind==='COMPANY').map(node=>node.id).sort(),['US:NVDA','US:TSM']);
 f.rows.set('company_relationships/inverse',{source:'US:NVDA',target:'US:TSM',type:'CUSTOMER_OF',status:'WITHDRAWN'});f.push();
 assert.equal((await read()).relationships.length,0);assert.equal(f.counts().files,0);
});

test('a held cold NVIDIA read does not block an unrelated company page',async t=>{
 const f=fixture((collection,steps)=>collection==='company_relationships'&&steps.some(step=>step.args[2]==='US:NVDA'));
 t.after(()=>{f.release();closeLocalCaches();});
 const nvidia={name:'NVIDIA',status:'DIRECTORY'},small={name:'Small',status:'DIRECTORY'};
 let completed=false;
 const cold=withCompanyPageReads(()=>loadCompanyNeighborhood(f.db,'US:NVDA',nvidia)).then(value=>{completed=true;return value;});
 const other=withCompanyPageReads(()=>loadCompanyNeighborhood(f.db,'US:SMALL',small));
 assert.equal(await Promise.race([other.then(()=>true),new Promise(resolve=>setImmediate(()=>resolve(false)))]),true);
 assert.equal(completed,false,'the other page finished while NVIDIA remained held');
 assert.equal(f.counts().files,0);f.release();await cold;
});

test('theme preview neighborhoods exclude other themes and withdrawn memberships without a directory scan',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const member={status:'PUBLISHED',primarySector:'sensors-vision',reviewedAt:'2026-10-24',sources:[]};
 const company={name:'Small',status:'DIRECTORY',themeIds:['robotics'],themeMemberships:{robotics:member}};
 f.rows.set('companies/US:NEIGHBOR',{...company,name:'Neighbor'});
 f.rows.set('companies/US:HIDDEN',{...company,name:'Hidden',themeMemberships:{robotics:{...member,status:'WITHDRAWN'}}});
 for(const [id,target,theme] of [['one','US:NEIGHBOR','robotics'],['hidden','US:HIDDEN','robotics'],['other','US:OTHER','space']])
  f.rows.set('company_relationships/'+id,{source:'US:SMALL',target,type:'SUPPLIER_OF',themeIds:[theme],status:'PUBLISHED',evidence:[{id:'source',title:'Source',url:'https://example.com/source'}]});
 const graph=await withCompanyPageReads(()=>loadCompanyNeighborhood(f.db,'US:SMALL',company,{theme:'robotics',catalog:legacyCatalog}));
 assert.equal(graph.relationships.filter(edge=>edge.type==='SUPPLIER_OF').length,1);
 assert(!graph.nodes.some(node=>node.id==='US:HIDDEN'||node.id==='US:OTHER'));
 assert(!f.readDocs.has('companies/US:OTHER'));assert.equal(f.counts().files,0);
});

test('a connected company batches all neighbors and reuses live corrections without one stream per neighbor',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const membership={status:'PUBLISHED',stageIds:[],stages:[],memberships:[],sources:[],order:0,asOf:'2026-10-24'};
 const company={name:'Small',symbol:'SMALL',status:'PUBLISHED',inGraph:membership};
 for(let i=0;i<45;i++){
  const id=`US:N${i}`;
  f.rows.set(`companies/${id}`,{name:`Neighbor ${i}`,symbol:`N${i}`,status:'DIRECTORY'});
  f.rows.set(`company_relationships/e${i}`,{source:'US:SMALL',target:id,type:'SUPPLIER_OF',status:'PUBLISHED',evidence:[{id:'filing',title:'Source',url:'https://www.sec.gov/Archives/filing'}]});
 }
 const read=()=>withCompanyPageReads(()=>loadCompanyNeighborhood(f.db,'US:SMALL',company));
 const result=await read();assert.equal(result.relationships.filter(e=>e.type==='SUPPLIER_OF').length,45);
 assert.deepEqual(f.counts(),{files:0,opens:4,gets:0},'two endpoint queries plus two ID batches cover all45neighbors');
 f.rows.set('companies/US:N1',{name:'Corrected',symbol:'N1',status:'DIRECTORY'});f.push();
 assert.equal((await read()).nodes.find(n=>n.id==='US:N1')?.name,'Corrected');
 f.rows.set('companies/US:N1',{isDeleted:true});f.push();
 assert.equal((await read()).nodes.some(n=>n.id==='US:N1'),false);
 assert.equal(f.counts().opens,4,'corrections and withdrawals reuse the same subscriptions');
});

test('theme membership lookup avoids valuation enrichment while the complete public graph retains it',async()=>{
 const root=globalThis as typeof globalThis&{__structureReads?:number;__valuationReads?:number};
 const before=[root.__structureReads,root.__valuationReads];root.__structureReads=0;root.__valuationReads=0;
 try{
 const graph={nodes:[{id:'US:MSFT',kind:'COMPANY',name:'Microsoft',stageIds:['cloud']}],relationships:[],sources:[],asOf:'2026-10-24'};
 const result=await build({entryPoints:['src/lib/company-themes/graph-service.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{
  name:'graph-structure-fixture',setup(plugin){
   plugin.onLoad({filter:/knowledge-graph[\\/]service\.ts$/},()=>({contents:`export async function loadKnowledgeGraphStructure(){globalThis.__structureReads++;return ${JSON.stringify(graph)};}export async function loadKnowledgeGraph(){throw Error('unexpected full graph');}export async function loadGraphValuations(db,graph){globalThis.__valuationReads++;return {...graph,nodes:graph.nodes.map(n=>({...n,marketCap:{value:123,currency:'USD'}}))};}`,loader:'js'}));
   plugin.onLoad({filter:/company-themes[\\/]catalog\.ts$/},()=>({contents:`export const loadThemeCatalog=async()=>${JSON.stringify(legacyCatalog)};`,loader:'js'}));
   plugin.onLoad({filter:/firebase[\\/]admin\.ts$/},()=>({contents:'export const getAdminFirestore=()=>({});',loader:'js'}));
   plugin.onLoad({filter:/^server-only$/},()=>({contents:'',loader:'js'}));
  }
 }]});
 const evaluated={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),evaluated,evaluated.exports);
 const {loadThemeGraphStructure,loadThemeGraph}=evaluated.exports as {loadThemeGraphStructure:(id:string)=>Promise<typeof graph>;loadThemeGraph:(id:string)=>Promise<typeof graph>};
 assert.equal((await loadThemeGraphStructure('ai')).nodes[0].name,'Microsoft');assert.equal(root.__valuationReads,0);
 const full=await loadThemeGraph('ai');assert.equal((full.nodes[0] as unknown as {marketCap:{value:number}}).marketCap.value,123);assert.equal(root.__valuationReads,1);
 await assert.rejects(loadThemeGraphStructure('missing'),/unpublished/);
 }finally{[root.__structureReads,root.__valuationReads]=before;}
});

test('company financial reads start before relationship resolution and the page does not await them or the global graph',async()=>{
 const bundle=await build({entryPoints:['src/components/company-ticker-route.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',plugins:[{
  name:'page-dependencies',setup(plugin){plugin.onResolve({filter:/.*/},args=>args.importer?{path:args.path,external:true}:undefined);}
 }]});
 const require=createRequire(import.meta.url);let finish!:()=>void,finishFinancials!:(value:unknown)=>void,finishEarnings!:()=>void,financials=0,graphReads=0,researchReads=0,inMap=false,peerReads=0;
 const earningsGate=new Promise<void>(resolve=>{finishEarnings=resolve;});
 const comparison=Promise.resolve({panels:[]});
 const neighborhood={nodes:[],relationships:[],sources:[],asOf:'2026-10-24'};
 const researchGate=new Promise<void>(resolve=>{finish=resolve;});
 const resolved={id:'US:SMALL',path:'/company/small',data:{symbol:'SMALL'}};
 const injected=(id:string)=>{
  if(id==='react'||id==='react/jsx-runtime')return require(id);
  if(id==='next/headers')return {headers:async()=>new Headers()};
  if(id.endsWith('/company-page-timing'))return {timeCompanyPhase:(_name:string,work:()=>unknown)=>work()};
  if(id.endsWith('/predictions/types'))return {normalizeTicker:(s:string)=>s};
  if(id.endsWith('/company-research-service'))return {
   loadCompanyResearch:async(ticker:string,record:unknown)=>{assert.equal(record,resolved);researchReads++;await researchGate;return {ticker,name:'Small',known:true,inMap,graphAvailable:true,neighborhood:inMap?neighborhood:null};},
   loadCompanyPageGraph:async()=>{graphReads++;throw Error('unrelated graph');}
  };
  if(id.endsWith('/fundamentals/service'))return {loadCompanyFundamentals:()=>{financials++;return new Promise(resolve=>{finishFinancials=resolve;});}};
  if(id.endsWith('/peer-comparison/service'))return {loadPeerComparison:(_id:string,options:{company:unknown;aiEligible:boolean})=>{assert.equal(options.company,resolved.data);assert.equal(options.aiEligible,inMap);peerReads++;return comparison;}};
  if(id.endsWith('/earnings/public-service'))return {loadLatestCompanyEarnings:async()=>{await earningsGate;return null;}};
  if(id.endsWith('/market-companies/routes'))return {chinaCompanyId:()=>null,companyPageUrl:()=>'/company/small'};
  if(id==='next/navigation')return {notFound:()=>{throw Error('404');},permanentRedirect:()=>{throw Error('redirect');}};
  return new Proxy({},{get:(_target,key)=>key==='__esModule'?false:()=>null});
 };
 const evaluated={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(injected,evaluated,evaluated.exports);
 const {CompanyTickerContent}=evaluated.exports as {CompanyTickerContent:(props:unknown)=>Promise<unknown>};
 const page=CompanyTickerContent({params:Promise.resolve({symbol:'SMALL'}),resolved});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(financials,1,'own financials begin while relationships are still blocked');assert.equal(researchReads,1);
 finish();const shell=await page;assert(shell,'HTML shell returns even though financial data has not resolved');
 assert.equal(financials,1);assert.equal(graphReads,0);
 const props=(value:unknown)=>{assert(isValidElement(value));return value.props as Record<string,unknown>;};
 const ticker=(props(shell).children as unknown[])[1],overview=props(ticker).overview;
 const timeline=props(props(overview).timeline).children as {type:(props:unknown)=>Promise<unknown>;props:unknown};
 finishFinancials({marketCap:{status:'estimated',currency:'USD',value:123,priceDate:'2026-10-24'}});
 const chart=await timeline.type(timeline.props);
 assert.equal(props(chart).graph,undefined,'partial neighborhoods must not suppress complete client graph hydration or sector peers');
 assert.deepEqual((props(chart).company as Record<string,unknown>).marketCap,{value:123,currency:'USD',priceDate:'2026-10-24'});
 assert.equal(financials,1,'timeline valuation reuses the pending company financial read');
 inMap=true;
 let mappedSettled=false;
 const mappedPending=CompanyTickerContent({params:Promise.resolve({symbol:'SMALL'}),resolved,pendingFundamentals:Promise.resolve(null)});
 void mappedPending.then(()=>{mappedSettled=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(mappedSettled,false,'earnings remain blocked independently of the comparison panel');
 assert.equal(peerReads,0,'offscreen peer comparison must never start in the page response');
 finishEarnings();const mapped=await mappedPending;
 assert.equal(financials,1,'the financial promise started before the content import is reused');
 const mappedOverview=props((props(mapped).children as unknown[])[1]).overview;
 const peerLoader=props(mappedOverview).comparison;
 assert.equal(props(peerLoader).companyId,'US:SMALL');
 assert.equal(props(peerLoader).pending,undefined,'only company identity is sent to the demand-loaded panel');
 const panel=props(props(mappedOverview).graphContent).children as {type:(props:unknown)=>Promise<unknown>;props:unknown};
 assert.equal(props(await panel.type(panel.props)).initialGraph,neighborhood);
 assert.equal(graphReads,0,'direct relationship panel must not fetch unrelated global valuations');
});

test('company phase diagnostics retain concurrent request identity, overlap and failure behavior',async()=>{
 const rows:Record<string,unknown>[]=[],sink=(row:Record<string,unknown>)=>{rows.push(row);};
 const headers=(id:string)=>new Headers({'x-ya-company-trace':id,'x-ya-company-start':String(Date.now()),'x-cloud-trace-context':'0123456789abcdef0123456789abcdef/123;o=1'});
 const first='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',second='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const one=traceCompanyPage('page',headers(first),()=>timeCompanyPhase('identity',async()=>{await gate;return 'one';}),sink);
 const two=traceCompanyPage('metadata',headers(second),async()=>timeCompanyPhaseSync('firestore_client',()=>2),sink);
 assert.equal(await two,2);release();assert.equal(await one,'one');
 assert.deepEqual(rows.map(row=>row.requestId),[second,first]);
 assert(rows.every(row=>row.cloudTraceId==='0123456789abcdef0123456789abcdef'));
 assert.deepEqual(rows.map(row=>(row.phases as {name:string}[]).map(p=>p.name)),[['firestore_client'],['identity']]);
 const problem=new Error('original');
 await assert.rejects(traceCompanyPage('page',headers(first),()=>timeCompanyPhase('identity',async()=>{throw problem;}),()=>{throw Error('logging failed');}),error=>error===problem);
});

test('late financial phases are correlated after the HTML shell returns; malformed timers do not log',async()=>{
 const rows:Record<string,unknown>[]=[],headers=new Headers({'x-ya-company-trace':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','x-ya-company-start':String(Date.now())});
 let release!:()=>void,pending!:Promise<number>;const gate=new Promise<void>(resolve=>{release=resolve;});
 await traceCompanyPage('page',headers,async()=>{pending=timeCompanyPhase('financials',async()=>{await gate;return 7;});},row=>{rows.push(row);});
 release();assert.equal(await pending,7);
 assert.equal(rows[0].event,'company_page_timing');assert.equal(rows[1].event,'company_page_phase');
 assert.equal(rows[1].requestId,rows[0].requestId);assert.equal(rows[1].name,'financials');
 const malformed=new Headers({'x-ya-company-trace':'private-client-text','x-ya-company-start':'1'});
 assert.equal(await traceCompanyPage('page',malformed,async()=>42,()=>{throw Error('must not log');}),42);
});

test('initial peer comparison never starts prices; demand reads only validated visible companies',async()=>{
 const bundled=await build({entryPoints:['src/lib/peer-comparison/service.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{
  name:'peer-read-fixture',setup(plugin){plugin.onResolve({filter:/.*/},args=>args.importer?{path:args.path,external:true}:undefined);}
 }]});
 const ids=Array.from({length:2000},(_,i)=>`US:P${i}`),priceStarts:string[]=[],priceFinishes:(()=>void)[]=[];
 let active=0,maxActive=0,financialReads=0;
 const injected=(id:string)=>{
  if(id.endsWith('/price-demand'))return demandHelpers;
  if(id.endsWith('/company-page-scope'))return {withCompanyPageReads:(work:()=>unknown)=>work()};
  if(id.endsWith('/change-cache'))return {changeCached:(_db:unknown,_key:unknown,_collections:unknown,work:()=>unknown)=>work()};
  if(id.endsWith('/company-page-timing'))return {timeCompanyPhase:(_name:string,work:()=>unknown)=>work()};
  if(id.endsWith('/firebase/admin'))return {getAdminFirestore:()=>({})};
  if(id.endsWith('/predictions/instrument'))return {marketDate:()=> '2026-10-24'};
  if(id.endsWith('/company-themes/catalog'))return {loadThemeCatalog:async()=>({})};
  if(id.endsWith('/company-themes/catalog-model'))return {catalogThemeIds:()=>['ai']};
  if(id==='./structure')return {loadPeerStructure:async()=>{throw Error('fixture selection owns graph');}};
  if(id.endsWith('/theme-group'))return {findPeerThemeGroup:async()=>({graph:{nodes:ids.map(id=>({id}))},group:{companies:ids.map(id=>({id})),market:'US'}})};
  if(id.endsWith('/company-document-cache'))return {loadCompanyDocuments:async(_db:unknown,collection:string,requested:string[])=>{
   if(collection==='company_fundamentals')financialReads+=requested.length;
   return requested.map(id=>({data:()=>({id})}));
  }};
  if(id.endsWith('/price-cache'))return {loadPeerPrices:async(_db:unknown,id:string)=>{
   priceStarts.push(id);active++;maxActive=Math.max(maxActive,active);
   await new Promise<void>(resolve=>{priceFinishes.push(resolve);});active--;return [{id}];
  }};
  if(id.endsWith('/model'))return {buildPeerComparison:(_id:string,nodes:{id:string}[],values:Map<string,unknown>,prices:Map<string,unknown>)=>({nodes:nodes.map(n=>n.id),financials:values.size,prices:[...prices.keys()],panels:[]})};
  throw Error(`Unexpected import ${id}`);
 };
 const evaluated={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(injected,evaluated,evaluated.exports);
 const load=(evaluated.exports as {loadPeerComparison:(id:string,options:unknown)=>Promise<unknown>}).loadPeerComparison;
 // The price source never resolves unless explicitly released. Initial SSR must
 // complete without calling it at all, regardless of the 2,000-company universe.
 const initial=await load('US:P0',{company:{}}) as {nodes:string[];financials:number;prices:unknown[];pricePeers:{id:string}[]};
 assert.deepEqual(initial.nodes,ids);assert.equal(initial.financials,2000);assert.deepEqual(initial.prices,[]);assert.equal(initial.pricePeers.length,2000);assert.equal(priceStarts.length,0);
 assert.equal(await load('US:P0',{priceIds:ids}),null);assert.equal(priceStarts.length,0);
 assert.equal(await load('US:P0',{priceIds:['US:OUTSIDE']}),null);assert.equal(priceStarts.length,0);
 assert.equal(await load('US:P0',{priceIds:['XSHE:000001']}),null);assert.equal(priceStarts.length,0);
 const requested=['US:P4','US:P8','US:P10'];
 const pending=load('US:P0',{priceIds:requested});
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.deepEqual(priceStarts,['US:P0',...requested]);assert.equal(financialReads,2000,'price demand must not reload sector financials');
 priceFinishes.splice(0).forEach(finish=>finish());
 const result=await pending as {nodes:string[];prices:string[]};
 assert.deepEqual(result.nodes,['US:P0',...requested]);assert.deepEqual(result.prices,['US:P0',...requested]);
 const page=load('US:P0',{priceIds:ids.slice(1,13)});
 for(let batch=0;batch<2;batch++){await new Promise<void>(resolve=>setImmediate(resolve));priceFinishes.splice(0).forEach(finish=>finish());}
 await page;assert.equal(maxActive,8);
 const controller=new AbortController(),beforeCancel=priceStarts.length;
 const cancelled=load('US:P0',{priceIds:ids.slice(1,13),signal:controller.signal});
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(priceStarts.length-beforeCancel,8);
 controller.abort();priceFinishes.splice(0).forEach(finish=>finish());
 assert.equal(await cancelled,null);assert.equal(priceStarts.length-beforeCancel,8,'abandoned pages do not start another file batch');
});
