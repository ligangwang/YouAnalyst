import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldPath, type Firestore} from 'firebase-admin/firestore';
import {loadEarningsMap} from '../../src/lib/earnings/map-issuers';
import {earningsCompanies, earningsCompany, restoreEarningsFixtures} from '../../src/lib/earnings/issuers';
import {closeLocalCaches} from '../../src/lib/local-cache/watch';
import {secIdentitySnapshot, supportedSecIdentitySnapshot} from '../../src/lib/earnings/identity-cache';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const listeners = new Set<()=>void>();
  let opens=0, gets=0, fail:((error:Error)=>void)|undefined;
  const db={collection:(name:string)=>{
    assert.equal(name,'collectors');
    const clauses:unknown[][]=[];
    const snapshot=()=>({docs:[...rows].filter(([id])=>clauses[0]?.[0]==='in'
      ? (clauses[0][1] as string[]).includes(id) : id>='sec-identity-'&&id<'sec-identity.').map(([id,data])=>({id,data:()=>data}))});
    const query={clauses,isEqual:(other:{clauses:unknown[][]})=>JSON.stringify(clauses)===JSON.stringify(other.clauses),
      where:(field:FieldPath,op:string,value:string|string[])=>{assert(field.isEqual(FieldPath.documentId()));clauses.push([op,value]);return query;},
      get:async()=>{gets++;return snapshot();},
      onSnapshot:(next:(value:ReturnType<typeof snapshot>)=>void,error:(error:Error)=>void)=>{
        if(clauses[0]?.[0]==='in')assert((clauses[0][1] as string[]).length<=30);
        else assert.deepEqual(clauses,[['>=','sec-identity-'],['<','sec-identity.']]);
        const push=()=>next(snapshot());
        opens++;listeners.add(push);fail=error;queueMicrotask(()=>{if(listeners.has(push))push();});
        return ()=>{listeners.delete(push);};
      }};
    return query;
  }} as unknown as Firestore;
  return {db,rows,get opens(){return opens;},get gets(){return gets;},get active(){return listeners.size;},
    push(){for(const next of listeners)next();},error(){fail!(Error('offline'));}};
}

test('1200 issuers reuse targeted live batches across messages; identity changes remain live',async t=>{
  t.after(()=>{closeLocalCaches();restoreEarningsFixtures();});
  const f=fixture();
  const graph:KnowledgeGraph={asOf:'2026-10-28',nodes:Array.from({length:1200},(_,i)=>({id:`US:T${i}`,name:`Company ${i}`,market:'US',kind:'COMPANY',order:i})),relationships:[],sources:[]};
  for(let i=0;i<1200;i++)f.rows.set(`sec-identity-US:T${i}`,{companyId:`US:T${i}`,cik:String(i+1).padStart(10,'0')});
  f.rows.set('sec-US:T0',{companyId:'US:T0',cik:'9999999999'});
  f.rows.set('sec-identity-US:OUTSIDE',{companyId:'US:OUTSIDE',cik:'9999999998'});
  await Promise.all(Array.from({length:8},()=>loadEarningsMap(f.db,graph)));
  for(let i=0;i<40;i++)await loadEarningsMap(f.db,graph);
  assert.equal(earningsCompanies().length,1200);
  assert.equal(f.opens,40);assert.equal(f.gets,0);assert.equal(f.active,40);
  f.rows.set('sec-identity-US:T0',{companyId:'US:T0',cik:'0000999999'});
  f.rows.delete('sec-identity-US:T1');
  f.rows.set('sec-identity-US:T2',{companyId:'US:WRONG',cik:'0000999998'});
  f.push();await loadEarningsMap(f.db,graph);
  assert.equal(earningsCompany('US:T0').issuerId,'sec:0000999999');
  assert.throws(()=>earningsCompany('US:T1'));assert.throws(()=>earningsCompany('US:T2'));
  assert.throws(()=>earningsCompany('US:OUTSIDE'));
  f.rows.set('sec-identity-US:T1',{companyId:'US:T1',cik:'0000000002'});f.push();
  await loadEarningsMap(f.db,{...graph,nodes:graph.nodes.slice(1)});
  assert.throws(()=>earningsCompany('US:T0'));assert.equal(earningsCompany('US:T1').issuerId,'sec:0000000002');
  assert.equal(f.gets,0);
  const opens=f.opens;
  closeLocalCaches();assert.equal(f.active,0);
  await loadEarningsMap(f.db,graph);assert.equal(f.opens,opens+40);
});

test('targeted identity reads exclude unrelated collectors and reuse order-independent batches',async t=>{
  t.after(closeLocalCaches);const f=fixture();
  for(let i=0;i<3280;i++)f.rows.set(`sec-identity-US:T${i}`,{companyId:`US:T${i}`,cik:'0000000001'});
  assert.equal((await supportedSecIdentitySnapshot(f.db,[])).size,0);assert.equal(f.opens,0);
  const ids=['US:T1','US:T2','US:MISSING'];
  assert.equal((await supportedSecIdentitySnapshot(f.db,ids)).size,2);
  assert.equal((await supportedSecIdentitySnapshot(f.db,[...ids].reverse())).size,2);
  assert.equal(f.opens,1);assert.equal(f.gets,0);
  f.rows.set('sec-identity-US:MISSING',{companyId:'US:MISSING',cik:'0000000002'});f.push();
  assert.equal((await supportedSecIdentitySnapshot(f.db,ids)).size,3);
  f.rows.delete('sec-identity-US:T1');f.push();
  assert.equal((await supportedSecIdentitySnapshot(f.db,ids)).has('sec-identity-US:T1'),false);
  assert.deepEqual([...await supportedSecIdentitySnapshot(f.db,['US:T2'])].map(([id])=>id),['sec-identity-US:T2']);
});

test('identity listener is isolated by client and retains the last snapshot during transient errors without polling',async t=>{
  t.after(closeLocalCaches);const a=fixture(),b=fixture();
  a.rows.set('sec-identity-US:A',{companyId:'US:A',cik:'0000000001'});
  assert.equal((await secIdentitySnapshot(a.db)).size,1);
  assert.equal((await secIdentitySnapshot(b.db)).size,0);
  a.error();assert.equal((await secIdentitySnapshot(a.db)).size,1);
  assert.equal(a.opens,1);assert.equal(a.gets,0);assert.equal(b.opens,1);
});

test('cold identity listener errors reject the load instead of authorizing an empty map or falling back to reads',async t=>{
  t.after(closeLocalCaches);let gets=0;
  const query={where:()=>query,get:async()=>{gets++;return {docs:[]};},
    onSnapshot:(_next:unknown,error:(e:Error)=>void)=>{queueMicrotask(()=>error(Error('permission denied')));return ()=>{};}};
  const db={collection:()=>query} as unknown as Firestore;
  await assert.rejects(secIdentitySnapshot(db),/permission denied/);
  assert.equal(gets,0);
});

test('targeted identity listener failures do not fall back to unverified reads',async t=>{
  t.after(closeLocalCaches);let gets=0;
  const query={where:()=>query,isEqual:(other:unknown)=>other===query,
    get:async()=>{gets++;return {docs:[]};},
    onSnapshot:(_next:unknown,error:(e:Error)=>void)=>{queueMicrotask(()=>error(Error('permission denied')));return ()=>{};}};
  const db={collection:()=>query} as unknown as Firestore;
  await assert.rejects(supportedSecIdentitySnapshot(db,['US:A']),/permission denied/);
  assert.equal(gets,0);
});
