import assert from 'node:assert/strict';
import test from 'node:test';
import {onboardingFixture} from '../helpers/instrument-onboarding';
import {ONBOARDING_COLLECTION,parseOnboardingRequest} from '../../src/lib/instrument-onboarding/model';
import {requestInstrumentOnboarding} from '../../src/lib/instrument-onboarding/queue';
import {REQUESTERS_COLLECTION,requesterId} from '../../src/lib/instrument-onboarding/requesters';

test('reader accepts legacy humans and explicit automated provenance, rejects ambiguous attribution',async()=>{
  const f=onboardingFixture();await f.enqueue();const human=f.request();
  assert.equal(parseOnboardingRequest(human).requestedByUid,'requester-one');
  assert.equal(parseOnboardingRequest({...human,requestedByUid:null,requestSource:'SEC_IPO'}).requestedByUid,null);
  for(const patch of [{requestedByUid:null},{requestSource:'unknown'},{requestSource:'SEC_IPO'},{requestedByUid:'',requestSource:undefined}]){
    assert.throws(()=>parseOnboardingRequest({...human,...patch}),/Invalid onboarding request/);
  }
});

test('human can join an automated job without creating a phantom requester or duplicating work',async()=>{
  const f=onboardingFixture();await f.enqueue();
  f.rows.set(`${ONBOARDING_COLLECTION}/${f.id}`,{...f.request(),requestedByUid:null,requestSource:'SEC_IPO'});
  f.rows.delete(`${ONBOARDING_COLLECTION}/${f.id}/${REQUESTERS_COLLECTION}/${requesterId('requester-one')}`);
  for(let i=0;i<2;i++)assert.equal((await requestInstrumentOnboarding(f.db,f.id,'real-user','US:NEW',f.clock())).created,false);
  assert.equal(f.request().requestedByUid,null);assert.equal(f.request().requestSource,'SEC_IPO');
  const requesters=[...f.rows].filter(([key])=>key.includes(`/${REQUESTERS_COLLECTION}/`));
  assert.equal(requesters.length,1);assert.equal(requesters[0][1].requestedByUid,'real-user');
  assert.deepEqual(f.calls,[]);
});

test('automated job can complete ordinary worker checkpoints and catch up without a human UID',async()=>{
  const f=onboardingFixture();await f.enqueue();
  f.rows.set(`${ONBOARDING_COLLECTION}/${f.id}`,{...f.request(),requestedByUid:null,requestSource:'SEC_IPO'});
  for(let i=0;i<30&&f.request().status!=='SUPPORTED';i++)await f.process();
  assert.equal(f.request().status,'SUPPORTED');assert.equal(f.request().requestedByUid,null);
  assert.equal(new Set(f.calls).size,f.calls.length);
});
