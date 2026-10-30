import assert from 'node:assert/strict';
import test from 'node:test';
import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import {OnboardingCapacityDeferred,requireOnboardingCapacity} from '../../src/lib/instrument-onboarding/capacity-control';
import {onboardingFixture} from '../helpers/instrument-onboarding';
import {drainInstrumentOnboarding} from '../../src/lib/instrument-onboarding/worker';

test('capacity check fails closed when monitoring is paused, missing, stale or unreadable',async()=>{
 const now=Date.parse('2026-10-28T12:00:00Z');let data:Record<string,unknown>|undefined={pauseNewBatches:false,monitorHeartbeatAt:Timestamp.fromMillis(now)};let fail=false;
 const db={collection:()=>({doc:()=>({get:async()=>{if(fail)throw Error('read failed');return {data:()=>data};}})})} as unknown as Firestore;
 await requireOnboardingCapacity(db,now);
 for(const value of [undefined,{pauseNewBatches:true,monitorHeartbeatAt:Timestamp.fromMillis(now)},{pauseNewBatches:false,monitorHeartbeatAt:Timestamp.fromMillis(now-180001)},{pauseNewBatches:false,monitorHeartbeatAt:Timestamp.fromMillis(now+30001)}]){
  data=value;await assert.rejects(()=>requireOnboardingCapacity(db,now),OnboardingCapacityDeferred);
 }
 fail=true;await assert.rejects(()=>requireOnboardingCapacity(db,now),OnboardingCapacityDeferred);
});

test('a capacity pause releases the lease without blocking or losing completed checkpoints',async()=>{
 const f=onboardingFixture();await f.enqueue();await f.process();
 const result=await drainInstrumentOnboarding(f.db,f.id,{...f.handlers,themes:async()=>{throw new OnboardingCapacityDeferred('pause');}},{clock:f.clock});
 assert.equal(result.status,'CONTINUE');assert.equal(f.request().status,'QUEUED');assert.equal(f.request().lastError,null);
 assert.equal(f.request().leaseOwner,null);assert.equal(f.request().leaseExpiresAt,0);assert.equal(f.request().attemptCount,0);
 assert.deepEqual(f.request().steps,{identity:'COMPLETE'});
 assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock})).status,'SUPPORTED');
});
