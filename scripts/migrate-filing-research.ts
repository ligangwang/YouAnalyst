import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { filingRelationship, filingRelationshipId } from "../src/lib/company-graph/market-storage";
import type { CompanyGraphEdge } from "../src/lib/company-graph/types";

const mapping = { company_graph_edges:"company_relationships", company_graph_runs:"company_research_runs", company_graph_requests:"company_research_requests" } as const;
type Saved = {path:string; data:FirebaseFirestore.DocumentData};
function target(path:string) {
  const [collection,id,...rest]=path.split("/");
  const destination=mapping[collection as keyof typeof mapping];
  assert(destination && id,"Unexpected migration path");
  return [destination,collection==="company_graph_edges"?filingRelationshipId(id):id,...rest].join("/");
}
function stable(value:unknown):string {
  if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";
  if(value && typeof value==="object")return "{"+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+stable(v)).join(",")+"}";
  return JSON.stringify(value);
}
async function main() {
  assert(process.argv.includes("--write") && process.env.GCP_PROJECT_ID,"Use --write with GCP_PROJECT_ID");
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  const db=getFirestore(), marker=db.collection("directory_syncs").doc("filing_research_v1");
  const roots=(await Promise.all(Object.keys(mapping).map(c=>db.collection(c).listDocuments()))).flat();
  if(!roots.length){console.log("All legacy company graph collections are absent.");return;}
  const path="output/company-graph-recovery.json";
  async function exportAll(){
    const records:Saved[]=[];
    async function visit(ref:DocumentReference){
      const snapshot=await ref.get();
      if(snapshot.exists)records.push({path:ref.path,data:snapshot.data()!});
      for(const collection of await ref.listCollections())for(const child of await collection.listDocuments())await visit(child);
    }
    for(let i=0;i<roots.length;i+=10)await Promise.all(roots.slice(i,i+10).map(visit));
    return records.sort((a,b)=>a.path.localeCompare(b.path));
  }
  async function verify(records:Saved[]){
    for(let i=0;i<records.length;i+=100){
      const chunk=records.slice(i,i+100), copies=await db.getAll(...chunk.map(r=>db.doc(target(r.path))));
      chunk.forEach((row,j)=>{
        assert(copies[j].exists,"Missing migrated record: "+row.path);
        for(const [key,value] of Object.entries(row.data)) assert(stable(copies[j].data()?.[key])===stable(value),"Changed migrated field: "+row.path+"/"+key);
      });
    }
  }
  if(process.argv.includes("--delete-legacy")){
    const bytes=await readFile(path), saved=(await marker.get()).data();
    assert(saved?.backupHash===createHash("sha256").update(bytes).digest("hex"),"Verified recovery export required");
    const {records}=JSON.parse(bytes.toString()) as {records:Saved[]};
    await verify(records);
    const live=await fetch("https://youanalyst.com/api/company-graph/NVDA?migration="+Date.now(),{signal:AbortSignal.timeout(30000)});
    assert(live.ok && live.headers.get("x-research-storage")==="company_research_runs","New production reader must be live");
    assert(stable(await exportAll())===stable(records),"Legacy records changed after backup; refusing deletion");
    for(const name of Object.keys(mapping))await db.recursiveDelete(db.collection(name));
    for(const name of Object.keys(mapping))assert((await db.collection(name).listDocuments()).length===0,"Deletion incomplete: "+name);
    await marker.set({deletedAt:new Date().toISOString()},{merge:true});
    console.log("Verified new research reader and deleted all three legacy company graph collections and subcollections.");
    return;
  }
  const records=await exportAll();
  for(const row of records){
    const started=String(row.data.processingStartedAt ?? row.data.updatedAt ?? "");
    assert(!(row.data.status==="PROCESSING" && Date.now()-Date.parse(started)<30*60*1000),"Research is still processing; retry migration after it completes");
  }
  await mkdir("output",{recursive:true});
  const bytes=JSON.stringify({project:process.env.GCP_PROJECT_ID,records});
  await writeFile(path,bytes);
  for(let i=0;i<records.length;i+=100){
    const chunk=records.slice(i,i+100), refs=chunk.map(r=>db.doc(target(r.path))), prior=await db.getAll(...refs), batch=db.batch();
    chunk.forEach((row,j)=>{
      if(prior[j].exists)return;
      const rootEdge=row.path.startsWith("company_graph_edges/") && row.path.split("/").length===2;
      batch.set(refs[j],rootEdge?filingRelationship(row.data as CompanyGraphEdge):row.data);
    });
    await batch.commit();
  }
  await verify(records);
  await marker.set({migratedAt:new Date().toISOString(),backupHash:createHash("sha256").update(bytes).digest("hex"),counts:Object.fromEntries(Object.keys(mapping).map(c=>[c,records.filter(r=>r.path.startsWith(c+"/")).length]))});
  console.log(JSON.stringify({migrated:true,documents:records.length,collections:Object.keys(mapping)}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Migration failed");process.exitCode=1;});
