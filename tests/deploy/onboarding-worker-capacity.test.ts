import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingWorkerCapacity} from '../../scripts/onboarding-worker-capacity.mjs';

const revision=(minimum:unknown,maximum:unknown)=>({metadata:{annotations:{'autoscaling.knative.dev/minScale':minimum,'autoscaling.knative.dev/maxScale':maximum}}});
test('preserves the temporary twenty-worker burst and later two-worker baseline',()=>{
  assert.deepEqual(onboardingWorkerCapacity(revision('20','20')),{minimum:20,maximum:20});
  assert.deepEqual(onboardingWorkerCapacity(revision('2','2')),{minimum:2,maximum:2});
  assert.deepEqual(onboardingWorkerCapacity(revision('2','20')),{minimum:2,maximum:20});
});
test('refuses unknown or invalid capacity instead of silently resetting a release',()=>{
  for(const value of [undefined,null,{},revision(undefined,'20'),revision('20',''),revision('0','20'),revision('20','2'),revision('2','1001'),revision('2','twenty')])assert.throws(()=>onboardingWorkerCapacity(value));
});
