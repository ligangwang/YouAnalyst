import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { Firestore } from 'firebase-admin/firestore';

test('separately evaluated server bundles share one relationship listener and cleanup', async () => {
  const result=await build({stdin:{contents:`
    export {observeFirestore} from './src/lib/firebase/firestore-observability';
    export {loadAllRelationships,loadPublishedRelationships} from './src/lib/knowledge-graph/relationship-cache';
    export {closeLocalCaches} from './src/lib/local-cache/watch';
  `,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
  type Bundle = typeof import('../../src/lib/knowledge-graph/relationship-cache')
    & typeof import('../../src/lib/firebase/firestore-observability')
    & typeof import('../../src/lib/local-cache/watch');
  const evaluate=()=>{
    const evaluated={exports:{}};
    new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),evaluated,evaluated.exports);
    return evaluated.exports as Bundle;
  };
  const a=evaluate(),b=evaluate();
  const entries:Record<string,unknown>[]=[];
  const batchDb=a.observeFirestore({getAll:async()=>[]} as unknown as Firestore,entry=>entries.push(entry));
  await batchDb.getAll({path:'events/example'} as never);
  assert.equal(entries.length,1);
  assert.match(String(entries[0].caller),/relationship-bundles\.test/);
  assert.doesNotMatch(String(entries[0].caller),/Proxy\.<anonymous>/);
  let opens=0,closes=0,next!:(snapshot:unknown)=>void;
  const raw={collection:(name:string)=>{
    assert.equal(name,'company_relationships');
    const query={path:name,where:(field:string,op:string,value:string)=>{assert.deepEqual([field,op,value],['status','==','PUBLISHED']);return query;},onSnapshot:(callback:(snapshot:unknown)=>void)=>{
      opens++;next=callback;return ()=>{closes++;};
    }};return query;
  }} as unknown as Firestore;
  const dbA=a.observeFirestore(raw,()=>{}),dbB=b.observeFirestore(raw,()=>{});
  assert.equal(dbA,dbB,'instrumentation must not create per-bundle cache identities');
  try {
    const reads=[a.loadPublishedRelationships(dbA),b.loadPublishedRelationships(dbB)];
    assert.equal(opens,1);
    const doc={id:'edge',data:()=>({status:'PUBLISHED'})};
    next({docs:[doc],docChanges:()=>[{type:'added',doc}]});
    assert.deepEqual((await Promise.all(reads)).map(r=>r.docs.length),[1,1]);
    next({docs:[],docChanges:()=>[{type:'removed',doc}]});
    assert.equal((await b.loadPublishedRelationships(dbB)).docs.length,0);
    assert.equal(opens,1);
    b.closeLocalCaches();assert.equal(closes,1);
    const reopened=a.loadPublishedRelationships(dbA);assert.equal(opens,2);
    next({docs:[],docChanges:()=>[]});await reopened;
  } finally { a.closeLocalCaches(); }
});
