import { test } from 'node:test';
import assert from 'node:assert/strict';
import { industryHierarchy } from '../../src/lib/hierarchy/industries';
import { hierarchyHref, hierarchyPath, validateHierarchy } from '../../src/lib/hierarchy/model';
import { isLocalizedPage, languageUrl } from '../../src/lib/ui/i18n/urls';
import { companyThemeNodeIds } from '../../src/lib/hierarchy/company-memberships';

test('SIC and CNI codes remain separate and deep links preserve leading zeros', () => {
  const nodes = industryHierarchy();
  assert.equal(hierarchyPath(nodes, 'SIC:3674').at(-1)?.names.en, 'Semiconductors & Related Devices');
  assert.equal(hierarchyPath(nodes, 'SIC:3674')[0].id, 'SIC');
  assert.equal(hierarchyHref('industries', 'SIC:0111'), '/industries?taxonomy=SIC&code=0111');
  assert.equal(hierarchyHref('investment-themes', 'ai.chips'), '/investment-themes?node=ai.chips');
  assert.deepEqual(hierarchyPath(nodes, 'SIC:unknown'), []);
});

test('invalid published catalogs cannot introduce cycles or dangling parents', () => {
  const node = { id: 'ai', parentId: null, names: { en: 'AI', 'zh-CN': '人工智能' }, order: 0 };
  assert.throws(() => validateHierarchy([node, node]));
  assert.throws(() => validateHierarchy([{ ...node, parentId: 'missing' }]));
  assert.throws(() => validateHierarchy([{ ...node, parentId: 'ai' }]));
});

test('locale switching preserves selected industry and theme', () => {
  for (const path of ['/industries?taxonomy=SIC&code=3674', '/investment-themes?node=ai.chips']) {
    const url = new URL(path, 'https://youanalyst.com');
    assert.ok(isLocalizedPage(url.pathname));
    const localized = languageUrl(url, 'zh-CN');
    assert.equal(localized.search, url.search);
    assert.equal(localized.pathname, `/zh-cn${url.pathname}`);
  }
});

test('company links include published assignments and legacy roles, excluding unknown or withdrawn assignments', () => {
  const nodes = ['ai', 'ai.chips', 'robotics', 'robotics.compute-control'].map((id, order) => ({ id, parentId: id.includes('.') ? id.split('.')[0] : null, names: { en: id, 'zh-CN': id }, order }));
  const result = companyThemeNodeIds({ themeMemberships: {
    ai: { status: 'PUBLISHED', assignments: [{nodeId:'ai.chips',status:'PUBLISHED'}, {nodeId:'missing',status:'PUBLISHED'}] },
    robotics: { status: 'PUBLISHED', primarySector: 'compute-control' },
    space: {status:'WITHDRAWN'},
  } }, nodes);
  assert.deepEqual(new Set(result), new Set(['ai', 'ai.chips', 'robotics', 'robotics.compute-control']));
  assert.deepEqual(companyThemeNodeIds({themeMemberships:{ai:{status:'DRAFT',assignments:[{nodeId:'ai.chips',status:'PUBLISHED'}]}}},nodes), []);
});

import {Firestore,Timestamp} from 'firebase-admin/firestore';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory,refreshCompanyDirectoryIds,withPageEntityReads} from '../../src/lib/local-cache/company-directory';
import {createHierarchyBrowser,hierarchyCompanyRows,hierarchyCompanyFields} from '../../src/lib/hierarchy/company-directory';
import {hierarchyPathLookup} from '../../src/lib/hierarchy/model';

const supported = (extra:Record<string,unknown>={})=>({name:'Alpha',status:'DIRECTORY',onboarding:{status:'SUPPORTED'},slug:'alpha',market:'US',taxonomy:'SIC',classification:['3674'],...extra});
function forbidden(row:Record<string,unknown>,keys:string[]){
 for(const key of keys)Object.defineProperty(row,key,{enumerable:true,get(){throw Error(`Unnecessary field: ${key}`);}});
 return row;
}
function directoryFixture(rows:Map<string,Record<string,unknown>>){
 const db=observeFirestore(new Firestore({projectId:'hierarchy-projection-test'}),()=>{});let loads=0;
 let update:Record<string,unknown>=supported();
 const raw={collection:()=>({doc:(id:string)=>({id})}),getAll:async(...refs:{id:string}[])=>refs.map(ref=>({id:ref.id,exists:true,data:()=>update}))} as unknown as Firestore;
 enableCompanyDirectory(db,raw,{sync:false,file:async()=>{loads++;return rows;}});
 return {db,loads:()=>loads,write:async(id:string,row:Record<string,unknown>)=>{update=row;await refreshCompanyDirectoryIds(db,[id]);}};
}
async function collect<T>(rows:AsyncIterable<T>){const result:T[]=[];for await(const row of rows)result.push(row);return result;}

test('industry refresh reads only classification and link fields, sharing the file across concurrent page scopes',async()=>{
 const row=forbidden(supported(),['searchPrefixes','description','inGraph','themeMemberships','financials']);
 const f=directoryFixture(new Map([
  ['US:A',row],['US:B',supported({isDeleted:true})],['US:C',supported({status:'DRAFT'})],
  ['US:D',supported({supersededByCompanyId:'US:A'})],['US:E',supported({onboarding:{status:'PROCESSING'}})],['US:F',supported({name:' '})],
 ]));
 const nodes=industryHierarchy(),browse=createHierarchyBrowser((kind,nodes)=>hierarchyCompanyRows(f.db,kind,nodes));
 const results=await Promise.all(Array.from({length:16},()=>withPageEntityReads(()=>browse('industries',nodes))));
 assert.equal(f.loads(),1);
 for(const result of results){assert.equal(result.unavailable,false);assert.equal(result.items.length,1);assert.equal(result.items[0].href,'/company/alpha');assert.deepEqual(result.items[0].nodeIds,hierarchyPath(nodes,'SIC:3674').map(node=>node.id));}
 assert.throws(()=>results[0].items[0].nodeIds.push('poison'));
 assert.equal((await browse('industries',nodes)).items[0].name,'Alpha');
});

test('theme refresh selects only published catalog membership placement, not classifications or evidence',async()=>{
 const nodes=['ai','ai.chips'].map((id,order)=>({id,parentId:order?'ai':null,names:{en:id,'zh-CN':id},order}));
 const membership=forbidden({status:'PUBLISHED',assignments:[{nodeId:'ai.chips',status:'PUBLISHED'}]},['sources','summaryTranslations']);
 const memberships=forbidden({ai:membership},['unrelated']);
 const row=forbidden(supported({themeMemberships:memberships,inGraph:{stageIds:['chips']}}),['searchPrefixes','classification','description']);
 const f=directoryFixture(new Map([['US:A',row]]));
 const rows=await collect(hierarchyCompanyRows(f.db,'investment-themes',nodes));
 assert.deepEqual(rows[0].themeMemberships,{ai:{status:'PUBLISHED',assignments:[{nodeId:'ai.chips',status:'PUBLISHED'}]}});
 assert.equal(rows[0].classification,undefined);
 const result=await createHierarchyBrowser((kind,nodes)=>hierarchyCompanyRows(f.db,kind,nodes))('investment-themes',nodes);
 assert.deepEqual(result.items[0].nodeIds,['ai','ai.chips']);
});

test('Firestore fallback uses a projected supported query and never opens a projected listener',async()=>{
 let calls=0,fields:string[]=[];
 const query={where:(field:string,op:string,value:string)=>{assert.deepEqual([field,op,value],['onboarding.status','==','SUPPORTED']);return query;},select:(...selected:string[])=>{fields=selected;return query;},get:async()=>{calls++;return {docs:[{id:'US:A',data:()=>forbidden(supported(),['searchPrefixes'])}]};},onSnapshot:()=>{throw Error('Must not listen');}};
 const db={collection:(name:string)=>{assert.equal(name,'companies');return query;}} as unknown as Firestore;
 const rows=await collect(hierarchyCompanyRows(db,'industries',industryHierarchy()));
 assert.equal(rows.length,1);assert.equal(calls,1);assert.deepEqual(fields,hierarchyCompanyFields('industries',industryHierarchy()));
});

test('refresh sees committed name/classification changes and removal without reloading the file',async()=>{
 let now=0;const nodes=industryHierarchy(),f=directoryFixture(new Map([['US:A',supported({updatedAt:new Timestamp(1,0)})]]));
 const browse=createHierarchyBrowser((kind,nodes)=>hierarchyCompanyRows(f.db,kind,nodes),()=>now);
 assert.equal((await browse('industries',nodes)).items[0].name,'Alpha');
 await f.write('US:A',supported({name:'Updated',classification:['7372'],updatedAt:new Timestamp(2,0)}));
 now=300_000;
 const result=await browse('industries',nodes);assert.equal(result.items[0].name,'Updated');assert(result.items[0].nodeIds.includes('SIC:7372'));
 await f.write('US:A',{isDeleted:true,updatedAt:new Timestamp(3,0)});now=600_000;
 assert.deepEqual((await browse('industries',nodes)).items,[]);assert.equal(f.loads(),1);
});

test('large scans and render projections yield to unrelated event-loop work between bounded batches',async()=>{
 let scanned=0,last=0,pauses=0;
 const rows=new Map(Array.from({length:4096},(_,i)=>[String(i),{get isDeleted(){scanned++;return false;},name:'not enrolled',status:'DIRECTORY',onboarding:{status:'PROCESSING'}}]));
 const f=directoryFixture(rows);
 await collect(hierarchyCompanyRows(f.db,'industries',industryHierarchy(),async()=>{assert(scanned-last<=128);last=scanned;pauses++;await nextTurn();}));
 assert(pauses>=32);
 let produced=0,otherPageAt=-1;
 const browse=createHierarchyBrowser(async function*(){for(let i=0;i<4096;i++){
  produced++;if(i===1)setImmediate(()=>{otherPageAt=produced;});
  yield {id:`US:A${i}`,name:'Alpha',taxonomy:'SIC',classification:['3674']};
 }});
 const result=await browse('industries',industryHierarchy());
 assert.equal(result.items.length,4096);assert(otherPageAt>0&&otherPageAt<4096,'unrelated page work runs before refresh completes');
});

test('expired concurrent refreshes coalesce; errors retry and old catalog completions cannot replace new results',async()=>{
 let now=0,loads=0,fail=false,release:()=>void=()=>{};
 let gate:Promise<void>|undefined;
 const browse=createHierarchyBrowser(async function*(_kind,nodes){loads++;if(gate)await gate;if(fail)throw Error('unavailable');yield {id:'US:A',name:nodes[0].names.en};},()=>now);
 const node={id:'ai',parentId:null,names:{en:'Old','zh-CN':'Old'},order:0};
 await browse('investment-themes',[node]);assert.equal(loads,1);
 now=300_000;gate=new Promise<void>(resolve=>{release=resolve;});
 const pending=Array.from({length:12},()=>browse('investment-themes',[node]));
 await nextTurn();assert.equal(loads,2);release();await Promise.all(pending);gate=undefined;
 now=600_000;fail=true;assert.equal((await browse('investment-themes',[node])).unavailable,true);
 fail=false;assert.equal((await browse('investment-themes',[node])).unavailable,false);
 now=900_000;gate=new Promise<void>(resolve=>{release=resolve;});const old=browse('investment-themes',[node]);await nextTurn();gate=undefined;
 const changed={...node,names:{en:'New','zh-CN':'New'}};
 assert.equal((await browse('investment-themes',[changed])).items[0].name,'New');release();await old;
 const before=loads;assert.equal((await browse('investment-themes',[changed])).items[0].name,'New');assert.equal(loads,before);
});

test('indexed hierarchy paths match existing lookup including absent IDs',()=>{
 const nodes=industryHierarchy(),path=hierarchyPathLookup(nodes);
 for(const id of ['SIC:3674','SIC:0111','CNI:C08030101','missing'])assert.deepEqual(path(id),hierarchyPath(nodes,id));
 assert.equal(path('SIC:3674'),path('SIC:3674'),'ancestor paths are reused');
});

test('a paused refresh uses one directory generation while later readers see concurrent committed updates',async()=>{
 const f=directoryFixture(new Map(Array.from({length:260},(_,i)=>[`US:A${String(i).padStart(3,'0')}`,supported()])));
 let pauses=0,started!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const reading=collect(hierarchyCompanyRows(f.db,'industries',industryHierarchy(),async()=>{if(++pauses===2){started();await gate;}}));
 await entered;await f.write('US:A259',supported({name:'Updated',updatedAt:new Timestamp(2,0)}));release();
 const previous=await reading;assert.equal(previous.at(-1)?.name,'Alpha');
 const current=await collect(hierarchyCompanyRows(f.db,'industries',industryHierarchy()));assert.equal(current.at(-1)?.name,'Updated');
 (current[0].classification as string[]).push('mutation');
 assert.deepEqual((await collect(hierarchyCompanyRows(f.db,'industries',industryHierarchy())))[0].classification,['3674']);
 assert.equal(f.loads(),1);
});

test('an industry refresh waiting on its source cannot hold up the theme view',async()=>{
 let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
 const browse=createHierarchyBrowser(async function*(kind){if(kind==='industries'){started();await gate;}yield {id:'US:A',name:'Alpha'};},()=>0,async()=>{});
 const industry=browse('industries',industryHierarchy());await entered;
 const theme=await browse('investment-themes',[]);assert.equal(theme.unavailable,false);assert.equal(theme.items.length,1);
 release();assert.equal((await industry).unavailable,false);
});

test('non-AI catalogs skip legacy graph data and safely project field names inherited by plain objects',async()=>{
 const nodes=[{id:'constructor',parentId:null,names:{en:'Constructor','zh-CN':'Constructor'},order:0}];
 const row=forbidden(supported({themeMemberships:{constructor:{status:'PUBLISHED',primarySector:'example'}}}),['inGraph','classification','searchPrefixes']);
 const f=directoryFixture(new Map([['US:A',row]]));
 const result=await createHierarchyBrowser((kind,nodes)=>hierarchyCompanyRows(f.db,kind,nodes))('investment-themes',nodes);
 assert.equal(result.unavailable,false);assert.deepEqual(result.items[0].nodeIds,['constructor']);
 assert.equal(Object.hasOwn(Object,'status'),false);
});
