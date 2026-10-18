import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { changeCached, CHANGE_CACHE_DOCUMENT } from '../../src/lib/change-cache';
import { loadPublishedRelationships } from '../../src/lib/knowledge-graph/relationship-cache';

test('graph rebuilds reuse relationships until relationship changes, including deletions', async () => {
  const state = { enabled: true, versions: {} as Record<string, string> };
  let reads = 0, fail = false;
  let ids = ['relationship-1'];
  const db = { collection(name: string) {
    if (name === 'collectors') return { doc(id: string) {
      assert.equal(id, CHANGE_CACHE_DOCUMENT);
      return { get: async () => ({ data: () => structuredClone(state) }) };
    } };
    assert.equal(name, 'company_relationships');
    return { get: async () => {
        reads++;
        if (fail) throw new Error('unavailable');
        return { docs: ids.map(id => ({ id, data: () => ({ status: 'PUBLISHED' }) })) };
      } };
  } } as unknown as Firestore;
  const graph = () => changeCached(db, 'test-graph',
    ['companies', 'company_relationships', 'company_fundamentals'], () => loadPublishedRelationships(db));
  await Promise.all([graph(), graph()]);
  assert.equal(reads, 1);
  for (const collection of ['company_fundamentals', 'companies']) {
    state.versions[collection] = 'changed';
    assert.equal((await graph()).docs.length, 1);
  }
  assert.equal(reads, 1, 'unrelated graph invalidations must not reread relationships');
  ids = [];
  state.versions.company_relationships = 'deleted';
  assert.equal((await graph()).docs.length, 0);
  assert.equal(reads, 2);
  state.versions.company_relationships = 'updated';
  fail = true;
  await assert.rejects(graph(), /unavailable/);
  fail = false;
  ids = ['relationship-2'];
  assert.equal((await graph()).docs[0].id, 'relationship-2');
  assert.equal(reads, 4, 'failed reads must be retried');
  state.enabled = false;
  await graph();
  await graph();
  assert.equal(reads, 6, 'disabled change delivery must bypass caching');
});

test('published relationships use the central selector without querying Firestore',async(t)=>{
 const {encode}=await import('../../src/lib/central-cache/codec');
 const previous=process.env.CENTRAL_CACHE_URL;process.env.CENTRAL_CACHE_URL='http://127.0.0.1:8088';
 t.after(()=>{if(previous===undefined)delete process.env.CENTRAL_CACHE_URL;else process.env.CENTRAL_CACHE_URL=previous;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url:unknown,options:RequestInit)=>{
  calls++;assert.equal(url,'http://127.0.0.1:8088/read');
  assert.deepEqual(JSON.parse(String(options.body)),{collection:'company_relationships',query:{status:'PUBLISHED'}});
  return new Response(JSON.stringify(encode([{id:'edge',data:{source:'US:A',target:'US:B',status:'PUBLISHED'}}])));
 });
 const db={collection:(name:string)=>{assert.equal(name,'company_relationships');return {doc:(id:string)=>({id}),get:()=>{throw Error('Unexpected Firestore read');}};}} as unknown as Firestore;
 const result=await loadPublishedRelationships(db);assert.equal(calls,1);assert.equal(result.docs[0].id,'edge');assert.equal(result.docs[0].get('target'),'US:B');
});
