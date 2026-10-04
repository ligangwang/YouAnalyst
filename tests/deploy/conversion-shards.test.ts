import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectTests, balanceTests, testWeight } from '../../scripts/conversion-shards.mjs';

const fixture={suites:[{title:'knowledge-graph.spec.ts',line:0,specs:[
 {file:'knowledge-graph.spec.ts',title:'tree overview pauses',tests:[{projectName:'desktop'},{projectName:'mobile'}]},
],suites:[{title:'nested group',line:5,specs:[{file:'knowledge-graph.spec.ts',title:'renders',tests:[{projectName:'desktop'}]}]}]},
{title:'new.spec.ts',line:0,specs:[{file:'new.spec.ts',title:'new coverage',tests:[{projectName:'mobile'}]}]}]};

test('shards include every collected project and nested test exactly once',()=>{
 const tests=collectTests(fixture),shards=balanceTests(tests,3);
 assert.equal(tests.length,4);
 assert(tests.some(t=>t.id==='[desktop] › knowledge-graph.spec.ts › nested group › renders'));
 assert.deepEqual(shards.flatMap(s=>s.tests.map(t=>t.id)).sort(),tests.map(t=>t.id).sort());
 assert.deepEqual(balanceTests([...tests].reverse(),3),shards,'assignment is deterministic');
});
test('expensive browser tests are spread across runners rather than grouped by file',()=>{
 const tests=Array.from({length:40},(_,i)=>({id:String(i),title:'tree overview pauses',file:'knowledge-graph.spec.ts',project:i%2?'mobile':'desktop'}));
 const shards=balanceTests(tests,4);
 assert(shards.every(s=>s.tests.length===10&&s.weight===300));
});
test('empty or duplicate collections and invalid shard counts fail closed',()=>{
 assert.throws(()=>collectTests({suites:[]}));
 assert.throws(()=>collectTests({suites:[...fixture.suites,...fixture.suites]}));
 assert.throws(()=>balanceTests([],0));
});
test('deployment uses balanced selection without disabling required browser coverage',()=>{
 const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
 assert(workflow.includes('node scripts/conversion-shards.mjs ${{ matrix.shard }}/4 --reporter=line,json'));
 assert(workflow.includes('needs: [browser-shard]'));
 assert(workflow.includes('test "$SHARD_RESULT" = success'));
});


test('long tree scenarios are balanced ahead of short UI cases using observed release costs',()=>{
 const slow={file:'knowledge-graph.spec.ts',project:'desktop',title:'tree tour pauses on hold and smoothly resumes the released view',id:'slow'};
 const continuous={...slow,title:'tree continuously surrounds the trunk and resumes after company details',id:'continuous'};
 const light={...slow,title:'opening relationship evidence preserves the current company',id:'light'};
 assert(testWeight(slow)>testWeight(continuous));
 assert(testWeight(continuous)>testWeight(light)*10);
 const shards=balanceTests([slow,continuous,...Array.from({length:30},(_,i)=>({...light,id:`light-${i}`}))],4);
 assert.notEqual(shards.findIndex(s=>s.tests.some(t=>t.id===slow.id)),shards.findIndex(s=>s.tests.some(t=>t.id===continuous.id)));
 assert.equal(new Set(shards.flatMap(s=>s.tests.map(t=>t.id))).size,32);
});
