// These unit fixtures exercise the local Firestore cache, not a deployed service.
delete process.env.CENTRAL_CACHE_URL;

import { loadPublishedRelationships, loadThemeRelationships, loadCompanyRelationships, loadFilingRelationships } from '../../src/lib/knowledge-graph/relationship-cache';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { applyCacheChange, CHANGE_CACHE_DOCUMENT, invalidateCompanyDocuments } from '../../src/lib/change-cache';
import { loadCompanyDocuments } from '../../src/lib/company-document-cache';
import { loadThemeEnrolledCompanies } from '../../src/lib/knowledge-graph/company-cache';
import { marketCapChanged } from '../../src/lib/company-change-index';

type Data = Record<string, unknown>;
function merge(a: Data, b: Data) { for(const [key,value] of Object.entries(b)) { if(value && typeof value==='object' && !Array.isArray(value)) { a[key]??={};merge(a[key] as Data,value as Data); } else a[key]=value; } }
function fixture() {
  const stored=new Map<string,Data>([[`collectors/${CHANGE_CACHE_DOCUMENT}`,{enabled:true,versions:{}}]]);
  const reads:string[]=[];let queries=0,transactions=0,fail=false,hold:Promise<void>|undefined;
  const snapshot=(path:string)=>{const data=structuredClone(stored.get(path));return {id:path.split('/').at(-1)!,exists:data!==undefined,data:()=>data,get:(key:string)=>data?.[key]};};
  const client=()=>({
    collection:(collection:string)=>({
      get:async()=>{queries++;return {docs:[...stored.keys()].filter(path=>path.startsWith(`${collection}/`)).map(snapshot)};},
      doc:(id:string)=>({path:`${collection}/${id}`,get:async()=>snapshot(`${collection}/${id}`)}),
      where:()=>({get:async()=>{queries++;return {docs:[...stored.keys()].filter(path=>path.startsWith(`${collection}/`) && (stored.get(path)?.themeIds as string[]|undefined)?.some(t=>['ai','robotics','space'].includes(t))).map(snapshot)};}}),
    }),
    getAll:async(...refs:{path?:string}[])=>{if(fail)throw Error('offline');const wait=hold;hold=undefined;const values=refs.filter(ref=>ref.path).map(ref=>{reads.push(ref.path!);return snapshot(ref.path!);});await wait;return values;},
    runTransaction:async(work:(tx:unknown)=>Promise<void>)=>{transactions++;const writes:[string,Data][]=[];await work({get:async(ref:{path:string})=>snapshot(ref.path),set:(ref:{path:string},data:Data)=>writes.push([ref.path,data])});assert.equal(new Set(writes.map(([path])=>path)).size,writes.length,'each shard is written once per transaction');for(const [path,data] of writes){const old=stored.get(path)??{};merge(old,data);stored.set(path,old);}},
  }) as unknown as Firestore;
  const db=client();
  const event=async(collection:string,id:string,paths?:string[])=>{
    const headers=new Headers({'ce-id':'event','ce-type':'google.cloud.firestore.document.v1.written','ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-subject':`documents/${collection}/${id}`,'content-type':'application/json'});
    const body=paths?Buffer.from(JSON.stringify({value:{},oldValue:{},updateMask:{fieldPaths:paths}})):undefined;
    await applyCacheChange(db,headers,'test',body);
  };
  return {db,client,stored,reads,event,get queries(){return queries;},get transactions(){return transactions;},fail:(value:boolean)=>{fail=value;},hold:()=>{let release!:()=>void;hold=new Promise<void>(resolve=>{release=resolve;});return release;}};
}

test('all instances refresh only the changed company; status writes keep market caps warm',async()=>{
  const f=fixture(),other=f.client();
  for(const id of ['US:A','US:B']){f.stored.set(`company_fundamentals/${id}`,{marketCap:{value:1}});await f.event('company_fundamentals',id);}
  const load=(db=f.db)=>loadCompanyDocuments(db,'company_fundamentals',['US:A','US:B'],'marketCap');
  await Promise.all([load(),load()]);await load(other);assert.equal(f.reads.length,4);
  await f.event('company_fundamentals','US:A',['pending','checkedAt']);await load();await load(other);assert.equal(f.reads.length,4);
  f.stored.set('company_fundamentals/US:A',{marketCap:{value:2}});await f.event('company_fundamentals','US:A',['marketCap.value']);
  assert.equal((await load())[0].get('marketCap') && ((await load())[0].get('marketCap') as Data).value,2);
  await load(other);assert.deepEqual(f.reads.slice(4),['company_fundamentals/US:A','company_fundamentals/US:A']);
  // Late/duplicate notifications reread current data, never replay an old snapshot.
  await f.event('company_fundamentals','US:A',['marketCap']);assert.equal(((await load())[0].get('marketCap') as Data).value,2);
});

test('new requests, deletions and recreations affect one entry; failed reads retry',async()=>{
  const f=fixture();await f.event('companies','US:A');f.stored.set('companies/US:A',{name:'A'});
  await loadCompanyDocuments(f.db,'companies',['US:A']);
  assert.equal((await loadCompanyDocuments(f.db,'companies',['US:A','US:B']))[1].exists,false);
  f.stored.set('companies/US:B',{name:'B'});await f.event('companies','US:B');f.fail(true);
  await assert.rejects(loadCompanyDocuments(f.db,'companies',['US:A','US:B']),/offline/);f.fail(false);
  assert.equal((await loadCompanyDocuments(f.db,'companies',['US:A','US:B']))[1].get('name'),'B');
  f.stored.delete('companies/US:A');await f.event('companies','US:A');
  assert.equal((await loadCompanyDocuments(f.db,'companies',['US:A','US:B']))[0].exists,false);
  assert.deepEqual(f.reads,['companies/US:A','companies/US:B','companies/US:B','companies/US:A']);
});

test('theme enrollment uses one initial query then ID updates, including new members and withdrawals',async()=>{
  const f=fixture();f.stored.set('companies/US:A',{themeIds:['ai']});await f.event('companies','US:A');
  assert.equal((await loadThemeEnrolledCompanies(f.db)).docs.length,1);
  f.stored.set('companies/US:B',{themeIds:['robotics']});await f.event('companies','US:B');
  assert.equal((await loadThemeEnrolledCompanies(f.db)).docs.length,2);
  f.stored.set('companies/US:A',{themeIds:[]});await f.event('companies','US:A');
  assert.deepEqual((await loadThemeEnrolledCompanies(f.db)).docs.map(doc=>doc.id),['US:B']);
  await loadThemeEnrolledCompanies(f.db);assert.equal(f.queries,1);assert.deepEqual(f.reads,['companies/US:B','companies/US:A']);
});

test('old receiver versions and disabled caches fall back safely during rollout',async()=>{
  const f=fixture();f.stored.set('companies/US:A',{name:'old'});await f.event('companies','US:A');
  await loadCompanyDocuments(f.db,'companies',['US:A']);
  f.stored.set('companies/US:A',{name:'new'});const state=f.stored.get(`collectors/${CHANGE_CACHE_DOCUMENT}`)!;
  (state.versions as Data).companies='legacy-receiver';
  assert.equal((await loadCompanyDocuments(f.db,'companies',['US:A']))[0].get('name'),'new');
  state.enabled=false;await loadCompanyDocuments(f.db,'companies',['US:A']);state.enabled=true;
  await loadCompanyDocuments(f.db,'companies',['US:A']);assert.equal(f.reads.length,4);
});

test('protobuf update masks distinguish market-cap changes, creations and deletions',()=>{
  const field=(tag:number,bytes:Uint8Array)=>Buffer.from([tag,bytes.length,...bytes]);
  const event=(path:string)=>Buffer.concat([field(10,Buffer.from('')),field(18,Buffer.from('')),field(26,field(10,Buffer.from(path)))]);
  assert.equal(marketCapChanged(event('checkedAt'),'application/protobuf'),false);
  assert.equal(marketCapChanged(event('marketCap.value'),'application/protobuf'),true);
  assert.equal(marketCapChanged(Buffer.from([18,0]),'application/protobuf'),true);
  assert.equal(marketCapChanged(Buffer.from([10,0]),'application/protobuf'),true);
  assert.equal(marketCapChanged(Buffer.from([26,255]),'application/protobuf'),true);
});

test('an older in-flight read cannot replace a refreshed company entry',async()=>{
  const f=fixture();f.stored.set('companies/US:A',{name:'old'});await f.event('companies','US:A');
  const release=f.hold(),old=loadCompanyDocuments(f.db,'companies',['US:A']);
  while(!f.reads.length)await new Promise(resolve=>setImmediate(resolve));
  f.stored.set('companies/US:A',{name:'new'});await f.event('companies','US:A');
  assert.equal((await loadCompanyDocuments(f.db,'companies',['US:A']))[0].get('name'),'new');
  release();assert.equal((await old)[0].get('name'),'old');
  assert.equal((await loadCompanyDocuments(f.db,'companies',['US:A']))[0].get('name'),'new');assert.equal(f.reads.length,2);
});

test('a legacy receiver change remains visible after a new receiver handles another company',async()=>{
  const f=fixture();f.stored.set('companies/US:A',{name:'old',themeIds:['ai']});await f.event('companies','US:A');
  await loadCompanyDocuments(f.db,'companies',['US:A']);await loadThemeEnrolledCompanies(f.db);
  f.stored.set('companies/US:A',{name:'new',themeIds:[]});
  const state=f.stored.get(`collectors/${CHANGE_CACHE_DOCUMENT}`)!;(state.versions as Data).companies='legacy-writer';
  // No reader observes the legacy-only version before the next new receiver.
  await f.event('companies','US:B');
  assert.equal((await loadCompanyDocuments(f.db,'companies',['US:A']))[0].get('name'),'new');
  assert.equal((await loadThemeEnrolledCompanies(f.db)).docs.length,0);
});

test('list invalidation deduplicates IDs and refreshes only affected entries in every instance',async()=>{
  const f=fixture(),other=f.client(),ids=['US:A','US:B','US:C'];
  for(const id of ids)f.stored.set(`company_fundamentals/${id}`,{marketCap:{value:1}});
  await invalidateCompanyDocuments(f.db,'company_fundamentals',ids);
  const load=(db:Firestore)=>loadCompanyDocuments(db,'company_fundamentals',ids,'marketCap');
  await load(f.db);await load(other);f.reads.length=0;
  for(const id of ids.slice(0,2))f.stored.set(`company_fundamentals/${id}`,{marketCap:{value:2}});
  await invalidateCompanyDocuments(f.db,'company_fundamentals',['US:A','US:B','US:A']);
  for(const db of [f.db,other])assert.deepEqual((await load(db)).map(doc=>(doc.get('marketCap') as Data).value),[2,2,1]);
  assert.deepEqual(f.reads,['company_fundamentals/US:A','company_fundamentals/US:B','company_fundamentals/US:A','company_fundamentals/US:B']);
  assert.equal(f.transactions,2);
  await invalidateCompanyDocuments(f.db,'company_fundamentals',ids,{marketCapChanged:false});await load(f.db);assert.equal(f.reads.length,4);
});

test('empty lists do nothing, invalid IDs fail before writes, and large lists use bounded chunks',async()=>{
  const f=fixture();await invalidateCompanyDocuments(f.db,'companies',[]);assert.equal(f.transactions,0);
  await assert.rejects(invalidateCompanyDocuments(f.db,'companies',['US:A','bad/path']),/Invalid company ID/);assert.equal(f.transactions,0);
  const ids=Array.from({length:501},(_,i)=>`US:COMPANY${i}`);
  await invalidateCompanyDocuments(f.db,'companies',ids);assert.equal(f.transactions,2);
  for(const id of [ids[0],ids[500]])f.stored.set(`companies/${id}`,{name:'old'});
  await loadCompanyDocuments(f.db,'companies',[ids[0],ids[500]]);f.reads.length=0;
  await invalidateCompanyDocuments(f.db,'companies',ids);
  await loadCompanyDocuments(f.db,'companies',[ids[0],ids[500]]);
  assert.deepEqual(f.reads,[`companies/${ids[0]}`,`companies/${ids[500]}`]);
});

test('relationship indexes share one load, refresh changed IDs and remove stale index memberships',async()=>{
  const f=fixture(), other=f.client();
  f.stored.set('company_relationships/a',{source:'US:A',target:'US:NVDA',status:'PUBLISHED',themeIds:['ai','robotics']});
  f.stored.set('company_relationships/b',{source:'US:NVDA',target:'US:B',status:'HIDDEN',themeIds:['space']});
  await invalidateCompanyDocuments(f.db,'company_relationships',['a','b']);
  const [published,robotics,nvda]=await Promise.all([loadPublishedRelationships(f.db),loadThemeRelationships(f.db,'robotics'),loadCompanyRelationships(f.db,['US:NVDA','US:A'],['b'])]);
  assert.deepEqual(published.docs.map(d=>d.id),['a']);assert.equal(robotics.docs.length,1);assert.equal(nvda.docs.length,2);assert.equal(f.queries,1);
  await loadPublishedRelationships(other);assert.equal(f.queries,2);
  f.stored.set('company_relationships/a',{source:'US:C',target:'US:D',status:'HIDDEN',themeIds:['space']});
  await f.event('company_relationships','a');
  assert.equal((await loadPublishedRelationships(f.db)).docs.length,0);
  assert.equal((await loadThemeRelationships(f.db,'robotics')).docs.length,0);
  assert.deepEqual((await loadCompanyRelationships(f.db,['US:NVDA'])).docs.map(d=>d.id),['b']);
  assert.equal((await loadCompanyRelationships(f.db,['US:NVDA'],['a'])).docs.length,2,'exact malformed/suppressed IDs retained');
  await loadPublishedRelationships(other);assert.deepEqual(f.reads,['company_relationships/a','company_relationships/a']);
  f.stored.delete('company_relationships/b');await f.event('company_relationships','b');f.fail(true);
  await assert.rejects(loadCompanyRelationships(f.db,['US:NVDA']),/offline/);f.fail(false);
  assert.equal((await loadCompanyRelationships(f.db,['US:NVDA'])).docs.length,0);assert.equal(f.queries,2);
  for(const id of ['filing:x2','filing:x1','filing:y1'])f.stored.set(`company_relationships/${id}`,{status:'NEEDS_REVIEW'});
  await invalidateCompanyDocuments(f.db,'company_relationships',['filing:x2','filing:x1','filing:y1']);
  assert.deepEqual((await loadFilingRelationships(f.db,'filing:x',1)).docs.map(d=>d.id),['filing:x1']);
});
