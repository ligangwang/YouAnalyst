import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldValue, type Firestore} from 'firebase-admin/firestore';
import {retireAiGraph} from '../src/lib/company-themes/retire-ai-graph';
import {isCollectionCompany} from '../src/lib/company-themes/model';
import {graphMembership} from '../src/lib/knowledge-graph/market-store';

test('retired enrollment is ignored by runtime readers', () => {
  const row = {id:'US:NVDA', name:'NVIDIA', status:'DIRECTORY', aiGraph:{status:'PUBLISHED'}};
  assert.equal(isCollectionCompany(row), false);
  assert.equal(graphMembership({...row, inGraph:undefined}), undefined);
});

test('cleanup previews, preserves canonical decisions and migrates legacy-only enrollment', async () => {
  const legacy = {status:'PUBLISHED', stageIds:['compute'], sources:['evidence']};
  for (const current of [undefined, {status:'WITHDRAWN'}, null]) {
    let row: Record<string, unknown> = {name:'NVIDIA', aiGraph:legacy, ...(current === undefined ? {} : {inGraph:current})};
    let writes = 0;
    const db = {collection: () => ({doc: () => ({})}), runTransaction: async (fn: (tx:unknown)=>Promise<unknown>) => fn({
      get: async () => ({data:()=>row}),
      update: (_ref:unknown, patch:Record<string, unknown>) => {
        writes++;
        assert.deepEqual(patch.aiGraph, FieldValue.delete());
        row = {...row, ...patch}; delete row.aiGraph;
      },
    })} as unknown as Firestore;
    await retireAiGraph(db,'US:NVDA'); assert.equal(writes,0);
    await retireAiGraph(db,'US:NVDA',true);
    assert.equal(writes,1); assert.equal(row.name,'NVIDIA'); assert(!Object.hasOwn(row,'aiGraph'));
    assert.deepEqual(row.inGraph,current === undefined ? legacy : current);
    assert.equal(await retireAiGraph(db,'US:NVDA',true),'unchanged'); assert.equal(writes,1);
  }
});
