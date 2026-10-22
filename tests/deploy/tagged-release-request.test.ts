import test from 'node:test';
import assert from 'node:assert/strict';
import {taggedReleaseRequest} from '../../scripts/tagged-release-request.mjs';

test('tagged 404 retries are bounded, logged without bodies, and check public health before waiting',async()=>{
  let calls=0,guards=0,waits=0;const logs:string[]=[];
  const r=await taggedReleaseRequest('https://tag.invalid/api/health',{}, {
    request:async()=>new Response('private response',{status:++calls<3?404:200}),
    beforeRetry:async()=>{guards++;},sleep:async()=>{waits++;},log:s=>logs.push(s),
  });
  assert.equal(r.status,200);assert.equal(calls,3);assert.equal(guards,2);assert.equal(waits,2);
  assert(logs.every(s=>!s.includes('private response')));
});
test('persistent 404 exhausts retries while other HTTP failures and network errors do not retry',async()=>{
  for(const status of [404,401,403,429,500]){
    let calls=0;
    const r=await taggedReleaseRequest('https://tag.invalid/',{}, {request:async()=>{calls++;return new Response('',{status});},sleep:async()=>{},log:()=>{}});
    assert.equal(r.status,status);assert.equal(calls,status===404?7:1);
  }
  let calls=0;
  await assert.rejects(taggedReleaseRequest('https://tag.invalid/',{}, {request:async()=>{calls++;throw Error('network');}}),/network/);
  assert.equal(calls,1);
});
test('failed public guard stops tagged retries immediately',async()=>{
  let calls=0;
  await assert.rejects(taggedReleaseRequest('https://tag.invalid/',{}, {request:async()=>{calls++;return new Response('',{status:404});},beforeRetry:async()=>{throw Error('public unhealthy');},log:()=>{}}),/public unhealthy/);
  assert.equal(calls,1);
});
test('write probes are never replayed',async()=>{
 let calls=0;
 const r=await taggedReleaseRequest('https://tag.invalid/api/write',{method:'POST'},{request:async()=>{calls++;return new Response('',{status:404});},sleep:async()=>{},log:()=>{}});
 assert.equal(r.status,404);assert.equal(calls,1);
});
