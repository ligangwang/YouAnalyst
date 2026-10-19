import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {loadPublishedRelationships} from '../../src/lib/knowledge-graph/relationship-cache';
test('published relationships reuse a push subscription without request-time reads',async()=>{
 let calls=0;let push:(value:unknown)=>void=()=>{};
 const doc={id:'edge',get:(field:string)=>({source:'US:A',target:'US:B',status:'PUBLISHED'}[field]),data:()=>({status:'PUBLISHED'})};
 const db={collection:()=>({onSnapshot:(next:(value:unknown)=>void)=>{calls++;push=next;next({docs:[doc]});return ()=>{};}})} as unknown as Firestore;
 assert.equal((await loadPublishedRelationships(db)).docs[0].id,'edge');
 assert.equal((await loadPublishedRelationships(db)).docs[0].get('target'),'US:B');
 push({docs:[]});assert.equal((await loadPublishedRelationships(db)).docs.length,0);assert.equal(calls,1);
});
