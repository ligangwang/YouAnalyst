import test from 'node:test';
import assert from 'node:assert/strict';
import {earningsFirestore} from '../helpers/earnings-firestore';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory} from '../../src/lib/local-cache/company-directory';
import type {Firestore,DocumentReference} from 'firebase-admin/firestore';

test('cold reads wait for the active store and replay the requested query instead of loading a directory',async()=>{
 const f=earningsFirestore();f.rows.set('companies/US:A',{name:'Active',rank:1});f.rows.set('companies/US:B',{name:'Other',rank:2});
 const db=observeFirestore(f.db,()=>{});let resolve!:(ready:boolean)=>void,loads=0;
 const gate=new Promise<boolean>(done=>{resolve=done;});
 enableCompanyDirectory(db,db,{marketReady:()=>gate,file:async()=>{loads++;throw Error('Must not load retired snapshot');}});
 const point=db.collection('companies').doc('US:A').get();
 const query=db.collection('companies').where('rank','==',1).limit(1).get();
 await Promise.resolve();assert.equal(f.queries.length,0);assert.equal(loads,0);
 resolve(true);
 const [doc,page]=await Promise.all([point,query]);
 assert.equal(doc.get('name'),'Active');assert.deepEqual(page.docs.map(d=>d.id),['US:A']);
 assert.equal(f.queries.length,1);assert.equal(loads,0);
});

test('active store projected batches preserve field masks and caller order',async()=>{
 const f=earningsFirestore();f.rows.set('companies/US:A',{name:'Alpha',privateValue:1});f.rows.set('companies/US:B',{name:'Beta',privateValue:2});
 const calls:string[][]=[];
 f.db.getAll=(async(...args:unknown[])=>{
  const options=args.pop() as {fieldMask:string[]};assert.deepEqual(options.fieldMask,['name']);
  const refs=args as DocumentReference[];calls.push(refs.map(ref=>ref.path));
  return Promise.all(refs.map(async ref=>{const doc=await ref.get();return {...doc,data:()=>({name:doc.get('name')})};}));
 }) as unknown as Firestore['getAll'];
 const db=observeFirestore(f.db,()=>{});
 enableCompanyDirectory(db,db,{marketReady:async()=>true,file:async()=>{throw Error('Retired snapshot');}});
 const docs=await db.getAll(db.collection('companies').doc('US:B'),db.collection('companies').doc('US:A'),{fieldMask:['name']});
 assert.deepEqual(docs.map(doc=>doc.id),['US:B','US:A']);assert.deepEqual(docs.map(doc=>doc.data()),[{name:'Beta'},{name:'Alpha'}]);
 assert.equal(calls.flat().length,2);assert.equal(f.queries.length,0);
});

test('an inactive store retains snapshot reads and a failed gate cannot trigger a full fallback scan',async()=>{
 const f=earningsFirestore(),db=observeFirestore(f.db,()=>{});let calls=0;
 enableCompanyDirectory(db,db,{marketReady:async()=>false,sync:false,file:async()=>{calls++;return new Map([['US:A',{name:'Snapshot'}]]);}});
 assert.equal((await db.collection('companies').doc('US:A').get()).get('name'),'Snapshot');assert.equal(calls,1);assert.equal(f.queries.length,0);
 const other=observeFirestore(earningsFirestore().db,()=>{});
 enableCompanyDirectory(other,other,{marketReady:async()=>{throw Error('Control unavailable');},file:async()=>{throw Error('Must not fall back');}});
 await assert.rejects(other.collection('companies').doc('US:A').get(),/Control unavailable/);
});
