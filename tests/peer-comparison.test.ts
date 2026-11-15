import {peerFinancialProjection} from '../src/lib/peer-comparison/financial-projection';
import assert from 'node:assert/strict';
import test from 'node:test';
import {PeerStructureCache} from '../src/lib/peer-comparison/structure-cache';
import {buildPeerComparison,peerGroup} from '../src/lib/peer-comparison/model';
import type {GraphNode} from '../src/lib/knowledge-graph/model';
import {findPeerThemeGroup} from '../src/lib/peer-comparison/theme-group';
const today='2026-10-14';
const node=(id:string,stage='compute',privateCompany=false):GraphNode=>({id,name:id,kind:'COMPANY',order:0,stageIds:[stage],listingStatus:privateCompany?'PRIVATE':'PUBLIC'});
const annual=(profit:number,end='2025-12-31',start='2025-01-01',unit='USD')=>({report:{end,form:'10-K'},metrics:[{label:'Net income',value:profit,unit,start,end},{label:'Revenue',value:100,unit,start,end},{label:'Diluted EPS',value:2,unit:`${unit}/shares`,start,end}]});
const cap=(value:number,date=today)=>({status:'estimated',value,currency:'USD',priceDate:date});

test('uncovered companies do not build every catalog graph; AI relationship neighbors remain eligible',async()=>{
 const themes=['ai',...Array.from({length:50},(_,i)=>`theme-${i}`)],calls:string[]=[];
 const empty={nodes:[],relationships:[],sources:[],asOf:''};
 assert.equal(await findPeerThemeGroup('US:OUTSIDE',undefined,themes,async theme=>{calls.push(theme);return empty;}),null);
 assert.deepEqual(calls,['ai']);
 calls.length=0;
 const selected=await findPeerThemeGroup('US:NEIGHBOR',undefined,themes,async theme=>{calls.push(theme);return {...empty,nodes:[node('US:NEIGHBOR')]};});
 assert.equal(selected?.group.companies[0].id,'US:NEIGHBOR');assert.deepEqual(calls,['ai']);
});

test('peer graphs follow published membership and catalog order, ignoring pending, unindexed and retired themes',async()=>{
 const calls:string[]=[];
 const company={themeIds:['robotics','pending','space','retired'],themeMemberships:{
  robotics:{status:'PUBLISHED' as const,primarySector:'compute-control'},space:{status:'PUBLISHED' as const,primarySector:'components'},
  pending:{status:'PENDING' as const,primarySector:'x'},unindexed:{status:'PUBLISHED' as const,primarySector:'x'},retired:{status:'PUBLISHED' as const,primarySector:'x'},
 }};
 const result=await findPeerThemeGroup('US:A',company,['pending','unindexed','ai','robotics','space'],async theme=>{
  calls.push(theme);return {nodes:theme==='space'?[node('US:A')]:[],relationships:[],sources:[],asOf:''};
 });
 assert.equal(result?.group.companies[0].id,'US:A');assert.deepEqual(calls,['ai','robotics','space']);
});
test('peers use the recorded role and same listing market, excluding private and unclassified companies',()=>{
 const group=peerGroup('US:A',[node('US:A'),node('US:B'),node('US:C','memory'),node('US:D','compute',true),node('XSHE:000001')]);
 assert.deepEqual(group?.companies.map(c=>c.id),['US:A','US:B']);assert.equal(peerGroup('US:X',[node('US:X','missing')]),null);
});
test('market caps share one price date; missing values stay missing and ties share ranks',()=>{
 const nodes=['A','B','C','D','E'].map(id=>node('US:'+id));
 const docs=new Map<string,unknown>([['US:A',{marketCap:cap(200)}],['US:B',{marketCap:cap(200)}],['US:C',{marketCap:cap(100)}],['US:D',{marketCap:cap(999,'2026-10-13')}]]);
 const result=buildPeerComparison('US:A',nodes,docs,new Map(),today)!;const panel=result.panels[0];
 assert.equal(panel.count,3);assert.equal(panel.median,200);assert(Math.abs(panel.mean-500/3)<1e-9);assert.deepEqual(panel.rows.map(r=>r.rank),[1,1,3,null,null]);assert.equal(result.total,5);
});
test('annual comparisons retain losses and zero, require full-year matching currency, and reject distant periods',()=>{
 const nodes=['A','B','C','D','E','F'].map(id=>node('US:'+id));
 const docs=new Map<string,unknown>([['US:A',{value:annual(0)}],['US:B',{value:annual(-20)}],['US:C',{value:annual(40,'2026-01-31','2025-02-01')}],['US:D',{value:annual(100,'2024-12-31','2024-01-01')}],['US:E',{value:annual(100,'2025-12-31','2025-10-01')}],['US:F',{value:annual(100,'2025-12-31','2025-01-01','EUR')}] ]);
 const panel=buildPeerComparison('US:A',nodes,docs,new Map(),today)!.panels.find(p=>p.key==='profit')!;
 assert.equal(panel.count,3);assert.equal(panel.median,0);assert.deepEqual(panel.rows.slice(0,3).map(r=>r.observation!.value),[40,0,-20]);assert.equal(panel.rows.find(r=>r.id==='US:D')!.observation,null);
});
test('A-share float capitalization uses tradable A-shares rather than total shares; EPS needs supported annual share basis',()=>{
 const docs=new Map<string,unknown>([['XSHE:000001',{marketCap:{...cap(1000),currency:'CNY',close:10,shares:{aShares:100,aTradableShares:60,totalShares:500}},cnAnnual:{end:'2025-12-31',metrics:[{label:'Net income attributable to parent',value:20,unit:'CNY',start:'2025-01-01',end:'2025-12-31'}]}}]]);
 const result=buildPeerComparison('XSHE:000001',[node('XSHE:000001')],docs,new Map(),today)!;
 assert.equal(result.panels.find(p=>p.key==='floatMarketCap')!.rows[0].observation!.value,600);assert.equal(result.panels.find(p=>p.key==='profit')!.rows[0].observation!.value,20);assert.equal(result.panels.some(p=>p.key==='eps'),false);
 const us=annual(10);us.report.form='20-F';assert.equal(buildPeerComparison('US:A',[node('US:A')],new Map([['US:A',{value:us}]]),new Map(),today)!.panels.some(p=>p.key==='eps'),false);
});
test('five-session returns require all six shared adjusted closes and never bridge a missing trading session',()=>{
 const dates=['2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13','2026-10-14'];
 const bars=(ticker:string)=>dates.map((tradingDate,i)=>({ticker,market:'US',tradingDate,close:100+i}));
 const a=bars('A'),b=bars('B').filter((_,i)=>i!==2);b.unshift({ticker:'B',market:'US',tradingDate:'2026-10-06',close:90});
 const result=buildPeerComparison('US:A',[node('US:A'),node('US:B')],new Map(),new Map([['US:A',a],['US:B',b]]),today)!;const panel=result.panels.find(p=>p.key==='fiveDayReturn')!;
 assert.equal(panel.count,1);assert(Math.abs(panel.rows[0].observation!.value-5)<1e-9);assert.equal(panel.rows[1].observation,null);assert.equal(panel.start,dates[0]);
});
test('unsupported or empty data produces no misleading metric panels',()=>{
 assert.deepEqual(buildPeerComparison('US:A',[node('US:A')],new Map(),new Map(),today)!.panels,[]);
 assert.equal(buildPeerComparison('ORG:PRIVATE',[node('ORG:PRIVATE')],new Map(),new Map(),today),null);
 const result=buildPeerComparison('US:A',[node('US:A')],new Map([['US:A',{marketCap:cap(100,'2026-10-15')}]]),new Map(),today)!;assert.equal(result.panels.length,0);
});
test('non-NVIDIA historical splits use provider-adjusted closes and invalid adjusted values stay unavailable',()=>{
 const dates=['2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13','2026-10-14'];
 const rows=(ticker:string)=>dates.map((tradingDate,i)=>({ticker,market:'US',tradingDate,close:i<3?200+i*2:100+i,rawClose:i<3?200+i*2:100+i,adjustedClose:100+i,source:'eodhd-eod'}));
 const a=rows('A'),b=rows('B');b[2].adjustedClose=0;
 const panel=buildPeerComparison('US:A',[node('US:A'),node('US:B')],new Map(),new Map([['US:A',a],['US:B',b]]),today)!.panels.find(p=>p.key==='fiveDayReturn')!;
 assert.equal(panel.count,1);assert(Math.abs(panel.rows[0].observation!.value-5)<1e-9);assert.equal(panel.rows[1].observation,null);
 const missing=a.map(row=>({...row,adjustedClose:undefined}));assert.equal(buildPeerComparison('US:A',[node('US:A')],new Map(),new Map([['US:A',missing]]),today)!.panels.length,0);
});


test('peer price histories use bounded Parquet queries and see committed corrections without listeners',async t=>{
 const {loadPeerPrices}=await import('../src/lib/peer-comparison/price-cache');
 const {createPriceFixture}=await import('./helpers/price-store');
 const {Firestore}=await import('firebase-admin/firestore');
 const {observeFirestore}=await import('../src/lib/firebase/firestore-observability');
 const {readHead,saveHead}=await import('../src/lib/price-store/storage');
 const f=createPriceFixture(),raw=new Firestore({projectId:'demo-parquet-peers'});let operations=0;
 const db=observeFirestore(raw,()=>{operations++;});
 globalThis.__youAnalystParquetStore=Promise.resolve(f.store);
 t.after(async()=>{globalThis.__youAnalystParquetStore=undefined;globalThis.__youAnalystPriceHead=undefined;await f.store.close();await raw.terminate();});
 await saveHead(f.bucket,await readHead(f.bucket),{version:1,ready:true,files:[]});
 const rows=Array.from({length:20},(_,i)=>{const date=`2026-10-${String(i+1).padStart(2,'0')}`;return {id:`US_AMD_${date}`,data:{market:'US',ticker:'AMD',tradingDate:date,close:i+1,rawClose:i+1,isFinal:true}};});
 await f.store.mutate(rows);
 const load=()=>loadPeerPrices(db,'US:AMD','US','2026-10-18');
 const [first,second]=await Promise.all([load(),load()]);assert.deepEqual(first,second);assert.equal(first.length,12);assert.equal(first[0].rawClose,18);
 await f.store.mutate([{id:'US_AMD_2026-10-18',data:{rawClose:99}}]);
 assert.equal((await load())[0].rawClose,99);assert.equal(operations,0);
});

test('visible price demand deduplicates the selected company and bounds expanded pages',async()=>{
 const {normalizePriceDemand,visiblePriceIds}=await import('../src/lib/peer-comparison/price-demand');
 const peers=Array.from({length:2000},(_,i)=>({id:`US:P${i}`}));
 assert.deepEqual(visiblePriceIds('US:P1',peers,false,0),['US:P1','US:P0','US:P2']);
 const first=visiblePriceIds('US:P1999',peers,true,0),second=visiblePriceIds('US:P1999',peers,true,1);
 assert.equal(first.length,13);assert.equal(second.length,13);assert.deepEqual(first.filter(id=>second.includes(id)),['US:P1999']);
 assert.deepEqual(normalizePriceDemand('US:P1',['US:P1','US:P2','US:P2']),['US:P1','US:P2']);
 assert.equal(normalizePriceDemand('US:P1',peers.map(p=>p.id)),null);
 assert.equal(normalizePriceDemand('US:P1',['../companies']),null);
});

test('price endpoint rejects oversized requests before loading and never publicly caches responses',async()=>{
 const {build}=await import('esbuild'),helpers=await import('../src/lib/peer-comparison/price-demand');
 const bundle=await build({entryPoints:['src/app/api/company-peer-prices/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'endpoint-fixture',setup(plugin){plugin.onResolve({filter:/.*/},args=>args.importer?{path:args.path,external:true}:undefined);}}]});
 let calls=0;
 const evaluated={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)((id:string)=>{
  if(id.endsWith('/price-demand'))return helpers;
  if(id.endsWith('/service'))return {loadPeerComparison:async(company:string,options:{priceIds:string[];signal:AbortSignal})=>{calls++;assert.equal(company,'US:A');assert.deepEqual(options.priceIds,['US:A','US:B']);assert(options.signal instanceof AbortSignal);return {panels:[]};}};
  throw Error(id);
 },evaluated,evaluated.exports);
 const {GET}=evaluated.exports as {GET:(request:Request)=>Promise<Response>};
 assert.equal((await GET(new Request('https://example.test/api?company=US:A&'+Array.from({length:14},(_,i)=>`peer=US:P${i}`).join('&')))).status,400);assert.equal(calls,0);
 const response=await GET(new Request('https://example.test/api?company=US:A&peer=US:B'));
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(await response.json(),{panel:null});assert.equal(calls,1);
});

test('peer structures coalesce readers and reject stale completion after a source update',async()=>{
 const cache=new PeerStructureCache<number>();let version='1',builds=0,release!:(value:number)=>void;
 const first=()=>cache.load('ai',()=>version,()=>{builds++;return new Promise<number>(resolve=>{release=resolve;});});
 const a=first(),b=first();assert.equal(a,b);await Promise.resolve();assert.equal(builds,1);
 version='2';assert.equal(await cache.load('ai',()=>version,async()=>2),2);
 release(1);assert.equal(await a,1);assert.equal(await b,1);
 assert.equal(await cache.load('ai',()=>version,async()=>99),2,'older completion cannot overwrite newer generation');
 version='3';assert.equal(await cache.load('ai',()=>version,async()=>3),3);
});

test('peer cache retries failed/mid-build generations, expires deterministically and bounds retained data',async()=>{
 let version='a',time=0,builds=0;
 const cache=new PeerStructureCache<number>(2,100,()=>time);
 await assert.rejects(cache.load('ai',()=>version,async()=>{throw Error('unavailable');}));
 assert.equal(await cache.load('ai',()=>version,async()=>{version='b';return 1;}),1);
 assert.equal(await cache.load('ai',()=>version,async()=>{builds++;return 2;}),2);
 assert.equal(await cache.load('ai',()=>version,async()=>99),2);
 time=60000;assert.equal(await cache.load('ai',()=>version,async()=>{builds++;return 3;}),3);assert.equal(builds,2);
 await cache.load('space',()=>version,async()=>4);await cache.load('robotics',()=>version,async()=>5);
 assert.equal(await cache.load('ai',()=>version,async()=>6),6,'least recently used graph is evicted');
 const tiny=new PeerStructureCache<string>(8,5);
 await tiny.load('ai',()=>version,async()=>'oversized');
 assert.equal(await tiny.load('ai',()=>version,async()=>'new'),'new','oversized graphs are not retained');
});

test('financial comparison endpoint validates before work, requests no prices, and redacts failures',async()=>{
 const {build}=await import('esbuild');let calls=0,fail=false;
 const bundle=await build({entryPoints:['src/app/api/company-peer-comparison/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'mock',setup(plugin){plugin.onResolve({filter:/.*/},args=>args.importer?{path:args.path,external:true}:undefined);}}]});
 const evaluated={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)(()=>({loadPeerComparison:async(company:string,options:{signal:AbortSignal;strict:boolean;priceIds?:string[]})=>{
  calls++;assert.equal(company,'US:A');assert.equal(options.priceIds,undefined);assert.equal(options.strict,true);assert(options.signal instanceof AbortSignal);if(fail)throw Error('private backend details');return null;
 }}),evaluated,evaluated.exports);
 const {GET}=evaluated.exports as {GET:(request:Request)=>Promise<Response>};
 assert.equal((await GET(new Request('https://test/api?company=bad'))).status,400);assert.equal(calls,0);
 const response=await GET(new Request('https://test/api?company=US:A'));
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(await response.json(),{data:null});
 fail=true;const error=await GET(new Request('https://test/api?company=US:A'));
 assert.equal(error.status,503);assert.equal(error.headers.get('Cache-Control'),'no-store');assert(!JSON.stringify(await error.json()).includes('private'));
});

test('peer structure integration reuses graph work and invalidates both push and projected-file generations',async()=>{
 const {build}=await import('esbuild');
 const bundle=await build({entryPoints:['src/lib/peer-comparison/structure.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'sources',setup(plugin){plugin.onResolve({filter:/.*/},args=>args.importer?{path:args.path,external:true}:undefined);}}]});
 let push=1,file=1,builds=0,name='Before';const db={};
 const evaluated={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)((id:string)=>{
  if(id==='./structure-cache')return {PeerStructureCache};
  if(id.endsWith('/entities'))return {localEntityVersions:()=>({companies:push,company_relationships:push})};
  if(id.endsWith('/company-directory'))return {companyDirectoryVersion:()=>file};
  if(id.endsWith('/graph-service'))return {loadThemeGraphStructure:async()=>{builds++;return {nodes:[{...node('US:A'),name}],relationships:[{large:'unused'}],sources:[{large:'unused'}],asOf:''};}};
  throw Error(id);
 },evaluated,evaluated.exports);
 const {loadPeerStructure}=evaluated.exports as {loadPeerStructure:(db:object,theme:string)=>Promise<{nodes:GraphNode[];relationships:unknown[];sources:unknown[]}>};
 const first=await Promise.all(Array.from({length:100},()=>loadPeerStructure(db,'ai')));
 assert.equal(builds,1);assert.equal(first[0],first[99]);assert.deepEqual(first[0].relationships,[]);assert.deepEqual(first[0].sources,[]);
 name='Push correction';push++;assert.equal((await loadPeerStructure(db,'ai')).nodes[0].name,name);assert.equal(builds,2);
 name='File correction';file++;assert.equal((await loadPeerStructure(db,'ai')).nodes[0].name,name);assert.equal(builds,3);
 assert.equal(first[0].nodes[0].name,'Before','existing readers keep their immutable generation');
});


test('compact peer documents preserve US and CN comparison output and drop unused payloads',()=>{
 for(const market of ['US','CN_A']){
  const nodes=market==='US'?[node('US:A'),node('US:B')]:[node('XSHG:600001'),node('XSHE:000001')];
  const metrics=[{label:market==='US'?'Net income':'Net income attributable to parent',value:-10,unit:market==='US'?'USD':'CNY',start:'2025-01-01',end:'2025-12-31',sourceUrl:'https://example.com/report'},{label:'Revenue',value:100,unit:market==='US'?'USD':'CNY',start:'2025-01-01',end:'2025-12-31'},{label:'Diluted EPS',value:2,unit:'USD/shares',start:'2025-01-01',end:'2025-12-31'},{label:'Unused',history:'x'.repeat(10000)}];
  const cap={status:'estimated',currency:market==='US'?'USD':'CNY',value:1000,close:10,priceDate:today,shares:{aTradableShares:20,aShares:100,sourceUrl:'https://example.com/shares'},history:'x'.repeat(10000)};
  const docs=new Map<string,unknown>(nodes.map((n,i)=>[n.id,{history:'x'.repeat(10000),value:{report:{end:'2025-12-31',form:'10-K'},metrics,marketCap:cap},...(i?{marketCap:cap}:{}),cnAnnual:{end:'2025-12-31',metrics}}]));
  const projected=new Map([...docs].map(([id,data])=>[id,peerFinancialProjection(data)]));
  assert.deepEqual(buildPeerComparison(nodes[0].id,nodes,projected,new Map(),today),buildPeerComparison(nodes[0].id,nodes,docs,new Map(),today));
  assert.ok(JSON.stringify([...projected]).length<JSON.stringify([...docs]).length/10);
 }
});
