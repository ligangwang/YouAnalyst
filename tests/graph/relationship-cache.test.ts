import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {loadPublishedRelationships} from '../../src/lib/knowledge-graph/relationship-cache';
test('published relationships reuse a push subscription without request-time reads',async()=>{
 let calls=0;let push:(value:unknown)=>void=()=>{};
 const doc={id:'edge',get:(field:string)=>({source:'US:A',target:'US:B',status:'PUBLISHED'}[field]),data:()=>({status:'PUBLISHED'})};
 const db={collection:()=>({where:(field:string,op:string,value:string)=>{assert.deepEqual([field,op,value],['status','==','PUBLISHED']);return {onSnapshot:(next:(value:unknown)=>void)=>{calls++;push=next;next({docs:[doc]});return ()=>{};}};}})} as unknown as Firestore;
 assert.equal((await loadPublishedRelationships(db)).docs[0].id,'edge');
 assert.equal((await loadPublishedRelationships(db)).docs[0].get('target'),'US:B');
 push({docs:[]});assert.equal((await loadPublishedRelationships(db)).docs.length,0);assert.equal(calls,1);
});

test('narrow relationship streams preserve publication changes, endpoint moves and exact suppression keys',async t=>{
 const {loadCompanyRelationships,loadThemeRelationships}=await import('../../src/lib/knowledge-graph/relationship-cache');
 const {closeLocalCaches}=await import('../../src/lib/local-cache/watch');t.after(closeLocalCaches);
 let rows=[
  {id:'a',source:'US:A',target:'US:B',status:'PUBLISHED',themeIds:['ai']},
  {id:'suppressed',source:'US:X',target:'US:Y',status:'REJECTED',themeIds:['robotics']},
  {id:'unrelated',source:'US:X',target:'US:Y',status:'PENDING',themeIds:['space']},
 ];
 const listeners:{field:string;op:string;value:unknown;next:(snapshot:unknown)=>void}[]=[];
 const push=()=>{for(const l of listeners){const matches=rows.filter(row=>{
  const v=l.field==='__name__'?row.id:row[l.field as keyof typeof row];
  return l.op==='in'?(l.value as unknown[]).includes(v):l.op==='array-contains'?Array.isArray(v)&&v.includes(String(l.value)):v===l.value;
 });l.next({docs:matches.map(row=>({id:row.id,data:()=>({...row})}))});}};
 const db={collection:()=>({where:(field:unknown,op:string,value:unknown)=>({onSnapshot:(next:(snapshot:unknown)=>void)=>{
  listeners.push({field:typeof field==='string'?field:'__name__',op,value,next});queueMicrotask(push);return ()=>{};
 }})})} as unknown as Firestore;
 assert.deepEqual((await loadPublishedRelationships(db)).docs.map(d=>d.id),['a']);
 assert.deepEqual((await loadCompanyRelationships(db,['US:A'],['suppressed'])).docs.map(d=>d.id).sort(),['a','suppressed']);
 assert.deepEqual((await loadThemeRelationships(db,'robotics')).docs.map(d=>d.id),['suppressed']);
 const count=listeners.length;
 rows=rows.map(r=>r.id==='a'?{...r,status:'REJECTED',source:'US:Z',target:'US:Y'}:r.id==='unrelated'?{...r,status:'PUBLISHED'}:r);push();
 assert.deepEqual((await loadPublishedRelationships(db)).docs.map(d=>d.id),['unrelated']);
 assert.deepEqual((await loadCompanyRelationships(db,['US:A'],['suppressed'])).docs.map(d=>d.id),['suppressed']);
 rows=rows.filter(r=>r.id!=='suppressed');push();
 assert.equal((await loadCompanyRelationships(db,['US:A'],['suppressed'])).docs.length,0);
 assert.equal(listeners.length,count,'warm reads reuse live queries');
});
