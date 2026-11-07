import test from 'node:test';
import assert from 'node:assert/strict';
import {intelligenceRequest} from '../../src/lib/ui/intelligence-request';
test('an HTML edge routing miss yields to one fresh read, preserving cancellation',async()=>{
 let reads=0;const controller=new AbortController();
 const request=(async(_url:string,options:RequestInit)=>{
  reads++;assert.equal(options.signal,controller.signal);
  if(reads===1)return new Response('The requested URL was not found on this server',{status:404,headers:{'Content-Type':'text/html'}});
  assert.equal(options.cache,'no-store');return Response.json({ready:true});
 }) as typeof fetch;
 assert.equal((await intelligenceRequest('/api/intelligence',{signal:controller.signal},request)).status,200);assert.equal(reads,2);
});
test('application misses, unavailable data, and repeated edge errors are not hidden',async()=>{
 for(const [status,contentType,body,expected] of [[404,'application/json','{"error":"Unknown theme"}',1],[404,'text/html','Application not found',1],[503,'text/html','Unavailable',1],[401,'application/json','{}',1],[404,'text/html','The requested URL was not found on this server',2]] as const){
  let reads=0;const request=(async()=>{reads++;return new Response(body,{status,headers:{'Content-Type':contentType}});}) as typeof fetch;
  assert.equal((await intelligenceRequest('/api/intelligence',{},request)).status,status);assert.equal(reads,expected);
 }
});
