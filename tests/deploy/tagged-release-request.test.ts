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

import {taggedUnauthenticatedProbe} from '../../scripts/tagged-release-request.mjs';
test('only explicit bodyless authentication probes retry a generic HTML routing miss',async()=>{
 let calls=0;
 const response=await taggedUnauthenticatedProbe('https://candidate.invalid/api/compare/community',{sleep:async()=>{},log:()=>{},request:async(_url,options)=>{
  calls++;assert.equal(options?.method,'POST');assert.equal(options?.credentials,'omit');assert.equal(options?.body,undefined);assert.equal(options?.headers,undefined);
  return calls===1?new Response('The requested URL was not found on this server',{status:404,headers:{'content-type':'text/html'}}):new Response('{}',{status:401});
 }});
 assert.equal(response.status,401);assert.equal(calls,2);
 await assert.rejects(taggedUnauthenticatedProbe('https://candidate.invalid/api/something-else'),/Unsupported authentication probe/);
});
test('authentication probe retries are bounded and never treat an app error as authentication success',async()=>{
 for(const [status,body,type,expected] of [[404,'The requested URL was not found on this server','text/html',3],[404,'Application not found','text/html',1],[404,'{}','application/json',1],[500,'error','text/html',1]] as const){
  let calls=0;
  const response=await taggedUnauthenticatedProbe('https://candidate.invalid/api/compare/community',{attempts:3,sleep:async()=>{},log:()=>{},request:async()=>{calls++;return new Response(body,{status,headers:{'content-type':type}});}});
  assert.equal(response.status,status);assert.equal(calls,expected);
 }
});
