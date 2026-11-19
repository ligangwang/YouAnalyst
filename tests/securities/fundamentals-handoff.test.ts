import assert from "node:assert/strict";
import test from "node:test";
import type { Bucket } from "@google-cloud/storage";
import { FieldValue, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { handoffWorkerControls } from "../../scripts/handoff-fundamentals-controls";
import { decode } from "../../src/lib/central-cache/codec";

function fixture() {
  const docs = new Map<string,DocumentData>();
  for (const id of ["_worker","_cn_worker"]) docs.set("market_ugc/company_fundamentals/records/"+id,{cursor:id,manualRequestedBy:"operator"});
  const objects = new Map<string,Buffer>();
  let failSeed = false;
  const bucket = { name:"test", file:(name:string) => ({
    name, bucket, exists:async()=>[objects.has(name)],
    getMetadata:async()=>[{generation:"7"}],
    download:async()=>[objects.get(name)!],
    save:async(bytes:Buffer)=> {
      if(failSeed && name.endsWith("/cn.json")) throw Error("upload failed");
      if(objects.has(name)) throw Object.assign(Error("exists"),{code:412});
      objects.set(name,bytes);
    },
  })};
  const snap=(path:string)=>({exists:docs.has(path),data:()=>docs.get(path),get:(key:string)=>docs.get(path)?.[key],updateTime:{seconds:100,nanoseconds:9}});
  const db={doc:(path:string)=>({path,get:async()=>snap(path)}),getAll:async(...refs:{path:string}[])=>refs.map(r=>snap(r.path)),
    batch:()=>{const pending=new Map<string,DocumentData>();return {
      update:(ref:{path:string},data:DocumentData)=>pending.set(ref.path,data),
      commit:async()=>{for(const [path,data] of pending){const row={...docs.get(path),...data};
        if(row.leaseTask instanceof FieldValue)delete row.leaseTask; docs.set(path,row);}},
    };}};
  return {docs,objects,fail:(value:boolean)=>{failSeed=value;},run:()=>handoffWorkerControls(db as unknown as Firestore,bucket as unknown as Bucket)};
}

test("active work blocks both fences and activation",async()=>{
  const f=fixture();f.docs.get("market_ugc/company_fundamentals/records/_cn_worker")!.leaseExpiresAtMs=Date.now()+60_000;
  await assert.rejects(f.run(),/active/);
  assert.equal(f.docs.get("market_ugc/company_fundamentals/records/_worker")!.leaseOwner,undefined);
  assert(!f.objects.has("worker-state/v1/fundamentals/handoff.json"));
});

test("an interrupted handoff recovers both original controls before activating",async()=>{
  const f=fixture();f.fail(true);await assert.rejects(f.run(),/upload failed/);
  assert(!f.objects.has("worker-state/v1/fundamentals/handoff.json"));
  for(const source of f.docs.values())assert.equal(source.leaseExpiresAtMs,Number.MAX_SAFE_INTEGER);
  f.fail(false);await f.run();
  for(const [kind,cursor] of [["sec","_worker"],["cn","_cn_worker"]]){
    const encoded=f.objects.get("worker-state/v1/fundamentals/"+kind+".json")!;
    assert.deepEqual(decode(JSON.parse(encoded.toString())),{cursor,manualRequestedBy:"operator"});
  }
  assert(f.objects.has("worker-state/v1/fundamentals/handoff.json"));
});
