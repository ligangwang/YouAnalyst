import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectTests, balanceTests, testWeight, recordTimings, loadTimings } from '../../scripts/conversion-shards.mjs';

const fixture={suites:[{title:'knowledge-graph.spec.ts',line:0,specs:[
 {file:'knowledge-graph.spec.ts',title:'tree overview pauses',tests:[{projectName:'desktop'},{projectName:'mobile'}]},
],suites:[{title:'nested group',line:5,specs:[{file:'knowledge-graph.spec.ts',title:'renders',tests:[{projectName:'desktop'}]}]}]},
{title:'new.spec.ts',line:0,specs:[{file:'new.spec.ts',title:'new coverage',tests:[{projectName:'mobile'}]}]}]};

const timings={fallback:1,files:{'knowledge-graph.spec.ts':5},tests:{}};

test('shards include every collected project and nested test exactly once',()=>{
 const tests=collectTests(fixture),shards=balanceTests(tests,3,timings);
 assert.equal(tests.length,4);
 assert(tests.some(t=>t.id==='[desktop] › knowledge-graph.spec.ts › nested group › renders'));
 assert.deepEqual(shards.flatMap(s=>s.tests.map(t=>t.id)).sort(),tests.map(t=>t.id).sort());
 assert.deepEqual(balanceTests([...tests].reverse(),3,timings),shards,'assignment is deterministic');
});
test('expensive browser tests are spread across runners rather than grouped by file',()=>{
 const tests=Array.from({length:40},(_,i)=>({id:String(i),title:'tree overview pauses',file:'knowledge-graph.spec.ts',project:i%2?'mobile':'desktop'}));
 const shards=balanceTests(tests,4,{...timings,tests:{}});
 assert(shards.every(s=>s.tests.length===10&&s.weight===50));
});
test('empty or duplicate collections and invalid shard counts fail closed',()=>{
 assert.throws(()=>collectTests({suites:[]}));
 assert.throws(()=>collectTests({suites:[...fixture.suites,...fixture.suites]}));
 assert.throws(()=>balanceTests([],0,timings));
});
test('deployment uses balanced selection without disabling required browser coverage',()=>{
 const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
 assert(workflow.includes('node scripts/conversion-shards.mjs ${{ matrix.shard }}/${{ strategy.job-total }} --reporter=line,json'));
 assert(workflow.includes('needs: [browser-coverage, browser-shard]'));
 assert(workflow.includes('test "$SHARD_RESULT" = success'));
});


test('recorded costs outrank file medians and keep long tree scenarios on separate runners',()=>{
 const slow={file:'knowledge-graph.spec.ts',project:'desktop',title:'tree tour pauses on hold and smoothly resumes the released view',id:'slow'};
 const continuous={...slow,title:'tree continuously surrounds the trunk and resumes after company details',id:'continuous'};
 const light={...slow,title:'opening relationship evidence preserves the current company',id:'light'};
 const recorded={...timings,tests:{slow:90,continuous:80}};
 assert.equal(testWeight(slow,recorded),90);
 assert.equal(testWeight(light,recorded),5,'unrecorded tests use their file median');
 assert.equal(testWeight({...light,file:'new.spec.ts'},recorded),1,'new files use the overall median');
 const shards=balanceTests([slow,continuous,...Array.from({length:30},(_,i)=>({...light,id:`light-${i}`}))],4,recorded);
 assert.notEqual(shards.findIndex(s=>s.tests.some(t=>t.id===slow.id)),shards.findIndex(s=>s.tests.some(t=>t.id===continuous.id)));
 assert.equal(new Set(shards.flatMap(s=>s.tests.map(t=>t.id))).size,32);
});

test('timings are recorded from every shard report, keeping costly tests and file medians',()=>{
 const report=(file:string,runs:[string,string,number][])=>({suites:[{title:file,line:0,specs:runs.map(([title,status,duration])=>({file,title,tests:[{projectName:'desktop',results:[{status,duration}]}]}))}]});
 const recorded=recordTimings([
  report('knowledge-graph.spec.ts',[['tour','passed',64_000],['timed out tour','timedOut',45_000],['short','passed',2_000]]),
  report('new.spec.ts',[['quick','passed',400],['skipped','skipped',0],['also quick','passed',600]]),
 ]);
 assert.deepEqual(recorded.tests,{'[desktop] › knowledge-graph.spec.ts › timed out tour':45,'[desktop] › knowledge-graph.spec.ts › tour':64});
 assert.deepEqual(recorded.files,{'knowledge-graph.spec.ts':45,'new.spec.ts':0.6});
 assert.equal(recorded.fallback,2);
 assert.throws(()=>recordTimings([report('new.spec.ts',[['skipped','skipped',0]])]));
});

test('committed browser timings cover the slow map scenarios',()=>{
 const committed=loadTimings();
 assert(Number.isFinite(committed.fallback)&&committed.fallback>0);
 assert(Object.values(committed.tests).every(seconds=>seconds>=5));
 assert(Object.keys(committed.tests).some(id=>id.includes('tree continuously surrounds the trunk')));
});
