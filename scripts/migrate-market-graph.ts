import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { importGraphs, type Graph } from "./import-ai-knowledge-graphs";
import { combineGraphs, type KnowledgeGraph } from "../src/lib/knowledge-graph/model";
import { graphFromMarket, relationshipId, type MarketCompany, type MarketRelationship } from "../src/lib/knowledge-graph/market-store";

async function main() {
  assert(process.argv.includes("--write") && process.env.GCP_PROJECT_ID, "Use --write with GCP_PROJECT_ID");
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  const db=getFirestore(), legacy=db.collection("knowledge_graphs");
  const roots=await legacy.listDocuments();
  if (!roots.length) { console.log("Legacy graph collection is absent; no migration or deletion needed."); return; }
  const backupPath="output/legacy-knowledge-graphs.json";
  const marker=db.collection("directory_syncs").doc("market_graph_v1");
  const records: {path:string;data:FirebaseFirestore.DocumentData}[]=[];
  async function exportDoc(ref:DocumentReference) {
    const doc=await ref.get();
    if(doc.exists) records.push({path:ref.path,data:doc.data()!});
    for(const child of await ref.listCollections()) for(const nested of await child.listDocuments()) await exportDoc(nested);
  }
  if (process.argv.includes("--delete-legacy")) {
    const bytes=await readFile(backupPath);
    const saved=(await marker.get()).data();
    assert(saved?.backupHash===createHash("sha256").update(bytes).digest("hex"),"Verified recovery export required");
    const archived=JSON.parse(bytes.toString()) as {records:typeof records;graphs:Graph[]};
    await verify(archived.graphs);
    const response=await fetch("https://youanalyst.com/api/knowledge-graph?migration="+Date.now(),{signal:AbortSignal.timeout(30000)});
    assert(response.ok && response.headers.get("x-graph-storage")==="market_company_relationships","Production must use the new store before deletion");
    assertGraph(archived.graphs,await response.json() as KnowledgeGraph);
    for(const ref of roots) await exportDoc(ref);
    assert(JSON.stringify(records)===JSON.stringify(archived.records),"Legacy data changed after export; migrate again before deletion");
    for(const ref of roots) await db.recursiveDelete(ref);
    assert((await legacy.listDocuments()).length===0,"Legacy deletion incomplete");
    await marker.set({deletedAt:new Date().toISOString()},{merge:true});
    console.log("Verified production graph and deleted legacy collection including all subcollections.");
    return;
  }
  const graphs:Graph[]=[];
  for(const id of ["ai-us","ai-cn-a"]) {
    const root=legacy.doc(id), pointer=(await root.get()).data();
    assert(pointer?.status==="READY" && typeof pointer.activeVersion==="string" && !pointer.activeVersion.includes("/"),"Published legacy graph required");
    const version=root.collection("versions").doc(pointer.activeVersion), metadata=(await version.get()).data();
    assert(metadata?.status==="READY","Complete legacy graph required");
    const [nodes,relationships,sources]=await Promise.all(["nodes","relationships","sources"].map(c=>version.collection(c).get()));
    graphs.push({...metadata,id,nodes:nodes.docs.map(d=>d.data()),relationships:relationships.docs.map(d=>d.data()),sources:sources.docs.map(d=>d.data())} as Graph);
  }
  for(const ref of roots) await exportDoc(ref);
  await mkdir("output",{recursive:true});
  const bytes=JSON.stringify({project:process.env.GCP_PROJECT_ID,records,graphs});
  await writeFile(backupPath,bytes);
  await importGraphs(db,graphs);
  await verify(graphs);
  await marker.set({migratedAt:new Date().toISOString(),backupHash:createHash("sha256").update(bytes).digest("hex"),backupPath});
  console.log(JSON.stringify({migrated:true,archivedDocuments:records.length,companies:graphs.reduce((n,g)=>n+g.coverage.companyCount,0)}));

  async function verify(graphs:Graph[]) {
    const [companies,edges]=await Promise.all([db.collection("market_companies").where("aiGraph.status","==","PUBLISHED").get(),db.collection("market_company_relationships").where("status","==","PUBLISHED").get()]);
    const graph=graphFromMarket(companies.docs.map(d=>({...d.data(),id:d.id}) as MarketCompany),edges.docs.map(d=>({...d.data(),id:d.id}) as MarketRelationship));
    assertGraph(graphs,graph);
  }
}
function assertGraph(graphs:Graph[],actual:KnowledgeGraph) {
  const expected=combineGraphs(graphs as unknown as (KnowledgeGraph & {id:string;language:string})[]);
  for(const n of expected.nodes) assert(actual.nodes.some(a=>a.id===n.id),"Migrated node missing: "+n.id);
  for(const e of expected.relationships) {
    const id=e.type==="PARTICIPATES_IN"?e.id:relationshipId(e.source,e.target,e.type);
    const found=actual.relationships.find(a=>a.id===id);
    assert(found && found.commercialStatus===e.commercialStatus,"Migrated relationship missing or changed: "+id);
    const urls=found.sourceIds.map(id=>actual.sources.find(s=>s.id===id)?.url);
    for(const sid of e.sourceIds) assert(urls.includes(expected.sources.find(s=>s.id===sid)?.url),"Relationship evidence missing");
  }
  for(const s of expected.sources) assert(actual.sources.some(a=>a.url===s.url && a.title===s.title),"Migrated evidence missing: "+s.id);
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Migration failed");process.exitCode=1;});
