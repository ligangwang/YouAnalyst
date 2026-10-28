import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldPath, type Firestore} from 'firebase-admin/firestore';
import {loadEarningsMap} from '../../src/lib/earnings/map-issuers';
import {earningsCompanies, earningsCompany, restoreEarningsFixtures} from '../../src/lib/earnings/issuers';
import {closeLocalCaches} from '../../src/lib/local-cache/watch';
import {secIdentitySnapshot} from '../../src/lib/earnings/identity-cache';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const listeners = new Set<(value: {docs: Array<{id:string;data:()=>Record<string,unknown>}>})=>void>();
  let opens=0, gets=0, fail:((error:Error)=>void)|undefined;
  const snapshot=()=>({docs:[...rows].filter(([id])=>id>='sec-identity-'&&id<'sec-identity.').map(([id,data])=>({id,data:()=>data}))});
  const db={collection:(name:string)=>{
    assert.equal(name,'collectors');
    const clauses:unknown[][]=[];
    const query={where:(field:FieldPath,op:string,value:string)=>{assert(field.isEqual(FieldPath.documentId()));clauses.push([op,value]);return query;},
      get:async()=>{gets++;return snapshot();},
      onSnapshot:(next:(value:ReturnType<typeof snapshot>)=>void,error:(error:Error)=>void)=>{
        assert.deepEqual(clauses,[['>=','sec-identity-'],['<','sec-identity.']]);
        opens++;listeners.add(next);fail=error;queueMicrotask(()=>{if(listeners.has(next))next(snapshot());});
        return ()=>{listeners.delete(next);};
      }};
    return query;
  }} as unknown as Firestore;
  return {db,rows,get opens(){return opens;},get gets(){return gets;},get active(){return listeners.size;},
    push(){for(const next of listeners)next(snapshot());},error(){fail!(Error('offline'));}};
}

test('1200 issuers reuse one live read across sequential and concurrent messages; identity changes remain live',async t=>{
  t.after(()=>{closeLocalCaches();restoreEarningsFixtures();});
  const f=fixture();
  const graph:KnowledgeGraph={asOf:'2026-10-28',nodes:Array.from({length:1200},(_,i)=>({id:`US:T${i}`,name:`Company ${i}`,market:'US',kind:'COMPANY',order:i})),relationships:[],sources:[]};
  for(let i=0;i<1200;i++)f.rows.set(`sec-identity-US:T${i}`,{companyId:`US:T${i}`,cik:String(i+1).padStart(10,'0')});
  f.rows.set('sec-US:T0',{companyId:'US:T0',cik:'9999999999'});
  f.rows.set('sec-identity-US:OUTSIDE',{companyId:'US:OUTSIDE',cik:'9999999998'});
  await Promise.all(Array.from({length:8},()=>loadEarningsMap(f.db,graph)));
  for(let i=0;i<40;i++)await loadEarningsMap(f.db,graph);
  assert.equal(earningsCompanies().length,1200);
  assert.equal(f.opens,1);assert.equal(f.gets,0);assert.equal(f.active,1);
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
  assert.equal(f.opens,1);assert.equal(f.gets,0);
  closeLocalCaches();assert.equal(f.active,0);
  await loadEarningsMap(f.db,graph);assert.equal(f.opens,2);
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
