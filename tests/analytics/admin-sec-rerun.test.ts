import test from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {runSecResponse} from "../../src/lib/admin-jobs/run-sec";
test("SEC manual run requires admin and returns accepted without awaiting execution",async(t)=>{
 t.mock.method(console,"error",()=>{});
 let calls=0;
 const dependencies:NonNullable<Parameters<typeof runSecResponse>[1]>={getUser:async()=>null,isAdmin:async()=>false,start:async uid=>{assert.equal(uid,"admin");calls++;return {operation:"operations/test"};}};
 const req=()=>new NextRequest("https://example.test/api/admin/jobs/sec",{method:"POST"});
 assert.equal((await runSecResponse(req(),dependencies)).status,401);
 dependencies.getUser=async()=>({uid:"admin"}) as never;
 assert.equal((await runSecResponse(req(),dependencies)).status,403);assert.equal(calls,0);
 dependencies.isAdmin=async()=>true;
 const response=await runSecResponse(req(),dependencies);assert.equal(response.status,202);assert.equal(calls,1);
 assert.equal(response.headers.get("Cache-Control"),"private, no-store");assert.equal((await response.json()).operation,"operations/test");
 dependencies.start=async()=>{throw Object.assign(Error("busy"),{code:"ALREADY_RUNNING"});};
 assert.equal((await runSecResponse(req(),dependencies)).status,409);
 dependencies.start=async()=>{throw Error("private cloud failure");};
 const failed=await runSecResponse(req(),dependencies);assert.equal(failed.status,502);assert(!JSON.stringify(await failed.json()).includes("private cloud"));
});

test("SEC trigger rejects active or recently dispatched runs and never acquires the worker lease",async()=>{
 const {reserveSecDispatch}=await import("../../src/lib/admin-jobs/run-sec");
 let stored:Record<string,unknown>={};
 const db={collection:()=>({doc:()=>({})}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({get:async()=>({data:()=>stored}),set:(_ref:unknown,data:Record<string,unknown>)=>{stored={...stored,...data};}})} as unknown as Parameters<typeof reserveSecDispatch>[0];
 await reserveSecDispatch(db,"admin",1000);assert.equal(stored.manualRequestedBy,"admin");assert.equal(stored.leaseExpiresAtMs,undefined);
 await assert.rejects(reserveSecDispatch(db,"admin",1001),{code:"ALREADY_RUNNING"});
 stored={leaseExpiresAtMs:200000};await assert.rejects(reserveSecDispatch(db,"admin",1001),{code:"ALREADY_RUNNING"});
 await reserveSecDispatch(db,"admin",200001);assert.equal(stored.leaseExpiresAtMs,200000);
});
