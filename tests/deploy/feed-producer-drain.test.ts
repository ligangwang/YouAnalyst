import assert from 'node:assert/strict';
import test from 'node:test';
import {needsFeedProducerDrain} from '../../scripts/feed-producer-drain.mjs';

const execution=(sha:string)=>({status:{conditions:[{type:'Completed',status:'Unknown'}]},spec:{template:{spec:{containers:[{env:[{name:'GIT_SHA',value:sha}]}]}}}});

test('new recurring executions cannot keep a pre-rollout producer drain open',()=>{
  assert.equal(needsFeedProducerDrain(execution('current'),'current'),false);
  assert.equal(needsFeedProducerDrain(execution('older'),'current'),true);
});

test('unidentified executions and missing release identity fail closed',()=>{
  assert.equal(needsFeedProducerDrain({status:{}},'current'),true);
  assert.equal(needsFeedProducerDrain(execution('current'),undefined),true);
  assert.equal(needsFeedProducerDrain(execution(''),'current'),true);
});

test('finished older executions no longer block, including failed executions',()=>{
  for(const status of [{completionTime:'2026-11-07T00:00:00Z'},{conditions:[{type:'Completed',status:'True'}]},{conditions:[{type:'Completed',status:'False'}]}]) {
    assert.equal(needsFeedProducerDrain({...execution('older'),status},'current'),false);
  }
});
