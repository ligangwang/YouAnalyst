import { test } from "node:test";
import assert from "node:assert/strict";
import { createMapFollowHandlers } from "../../src/lib/knowledge-graph/follows";
test("follows are private, token-owned, validated and idempotent", async()=>{
 const records = new Map<string,string[]>(); let reads=0;
 const handlers=createMapFollowHandlers({authenticate:async r=>r.headers.get("authorization")==="Bearer alice"?"alice":null,
 read:async uid=>{reads++;return records.get(uid);},exists:async id=>id==="US:NVDA",
 update:async(uid,id,follow)=>{const current=records.get(uid)??[];const next=follow?[...new Set([...current,id])]:current.filter(x=>x!==id);records.set(uid,next);return next;}});
 const req=(body?:unknown,auth=true)=>new Request("http://test/?uid=bob",{method:body?"PATCH":"GET",headers:auth?{authorization:"Bearer alice"}:{},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await handlers.GET(req(undefined,false))).status,401); assert.equal(reads,0);
 assert.equal((await handlers.PATCH(req({companyId:"US:NVDA",follow:true},false))).status,401);
 for(const body of [{companyId:"../bob",follow:true},{companyId:"US:NVDA",follow:"true"}]) assert.equal((await handlers.PATCH(req(body))).status,400);
 assert.equal((await handlers.PATCH(req({companyId:"UNKNOWN",follow:true}))).status,404);
 for(const follow of [true,true,false,false]){const response=await handlers.PATCH(req({companyId:"US:NVDA",follow}));assert.equal(response.headers.get("cache-control"),"private, no-store");assert.deepEqual(await response.json(),{companyIds:follow?["US:NVDA"]:[]});}
 assert.equal(records.has("bob"),false);
});
