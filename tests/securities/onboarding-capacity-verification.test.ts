import assert from 'node:assert/strict';
import test from 'node:test';
import {OnboardingCapacityDeferred} from '../../src/lib/instrument-onboarding/capacity-control';
import {verifyOnboardingCapacity} from '../../src/lib/instrument-onboarding/capacity-verification';

test('deployment waits for the next healthy heartbeat without bypassing the check',async()=>{
  let checks=0;const waits:number[]=[];
  const attempts=await verifyOnboardingCapacity(async()=>{
    if(++checks<3)throw new OnboardingCapacityDeferred('stale');
  },async ms=>{waits.push(ms);});
  assert.equal(attempts,3);assert.equal(checks,3);assert.deepEqual(waits,[10000,10000]);
});

test('persistently unsafe capacity remains blocked after a bounded number of reads',async()=>{
  let checks=0;const waits:number[]=[];const failure=new OnboardingCapacityDeferred('paused');
  await assert.rejects(()=>verifyOnboardingCapacity(async()=>{checks++;throw failure;},async ms=>{waits.push(ms);}),error=>error===failure);
  assert.equal(checks,7);assert.equal(waits.reduce((sum,ms)=>sum+ms,0),60000);
});

test('healthy capacity returns immediately and unexpected failures are not retried',async()=>{
  const sleep=async()=>{assert.fail('unexpected wait');};
  assert.equal(await verifyOnboardingCapacity(async()=>{},sleep),1);
  const failure=new Error('invalid configuration');
  await assert.rejects(()=>verifyOnboardingCapacity(async()=>{throw failure;},sleep),error=>error===failure);
});
