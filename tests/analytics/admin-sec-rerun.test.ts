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

test("A-share fundamentals manual run uses its own worker lease and job",async(t)=>{
 t.mock.method(console,"error",()=>{});
 const {reserveWorkerDispatch,runWorkerResponse}=await import("../../src/lib/admin-jobs/run-sec");
 const leases:string[]=[];let stored:Record<string,unknown>={};
 const db={collection:()=>({doc:(id:string)=>{leases.push(id);return {};}}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({get:async()=>({data:()=>stored}),set:(_ref:unknown,data:Record<string,unknown>)=>{stored={...stored,...data};}})} as unknown as Parameters<typeof reserveWorkerDispatch>[0];
 await reserveWorkerDispatch(db,"admin",1000,"cnFundamentals");
 assert.deepEqual(leases,["_cn_worker"]);
 await assert.rejects(reserveWorkerDispatch(db,"admin",1001,"cnFundamentals"),/A-share fundamentals is already running/);
 const req=()=>new NextRequest("https://example.test/api/admin/jobs/cn-fundamentals",{method:"POST"});
 let started=0;
 const ok=await runWorkerResponse("cnFundamentals",req(),{getUser:async()=>({uid:"admin"}) as never,isAdmin:async()=>true,start:async()=>{started++;return {operation:"operations/cn"};}});
 assert.equal(ok.status,202);assert.equal(started,1);
 const denied=await runWorkerResponse("cnFundamentals",req(),{getUser:async()=>({uid:"user"}) as never,isAdmin:async()=>false,start:async()=>{started++;return {operation:"x"};}});
 assert.equal(denied.status,403);assert.equal(started,1);
 const busy=await runWorkerResponse("cnFundamentals",req(),{getUser:async()=>({uid:"admin"}) as never,isAdmin:async()=>true,start:async()=>{throw Object.assign(Error("busy"),{code:"ALREADY_RUNNING"});}});
 assert.equal(busy.status,409);assert.match((await busy.json()).error,/A-share fundamentals/);
});

test("Private company valuations manual run uses its own worker lease and job",async(t)=>{
 t.mock.method(console,"error",()=>{});
 const {reserveWorkerDispatch,runWorkerResponse}=await import("../../src/lib/admin-jobs/run-sec");
 const leases:string[]=[];let stored:Record<string,unknown>={};
 const db={collection:()=>({doc:(id:string)=>{leases.push(id);return {};}}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({get:async()=>({data:()=>stored}),set:(_ref:unknown,data:Record<string,unknown>)=>{stored={...stored,...data};}})} as unknown as Parameters<typeof reserveWorkerDispatch>[0];
 await reserveWorkerDispatch(db,"admin",1000,"privateValuations");
 assert.deepEqual(leases,["_private_valuation_worker"]);
 await assert.rejects(reserveWorkerDispatch(db,"admin",1001,"privateValuations"),/Private company valuations is already running/);
 const req=()=>new NextRequest("https://example.test/api/admin/jobs/private-valuations",{method:"POST"});
 let started=0;
 const ok=await runWorkerResponse("privateValuations",req(),{getUser:async()=>({uid:"admin"}) as never,isAdmin:async()=>true,start:async()=>{started++;return {operation:"operations/private"};}});
 assert.equal(ok.status,202);assert.equal(started,1);
 const denied=await runWorkerResponse("privateValuations",req(),{getUser:async()=>({uid:"user"}) as never,isAdmin:async()=>false,start:async()=>{started++;return {operation:"x"};}});
 assert.equal(denied.status,403);assert.equal(started,1);
 const busy=await runWorkerResponse("privateValuations",req(),{getUser:async()=>({uid:"admin"}) as never,isAdmin:async()=>true,start:async()=>{throw Object.assign(Error("busy"),{code:"ALREADY_RUNNING"});}});
 assert.equal(busy.status,409);assert.match((await busy.json()).error,/Private company valuations/);
});
