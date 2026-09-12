import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Firestore } from "firebase-admin/firestore";
import { validateGraph, graphVersion, importGraphs, type Graph } from "../scripts/import-ai-knowledge-graphs";

import { graphFromMarket, type MarketCompany, type MarketRelationship } from "../src/lib/knowledge-graph/market-store";

const graphs: Graph[] = ["ai-us", "ai-cn-a"].map(id => JSON.parse(readFileSync(new URL(`../data/ai-supply-chain/${id}.json`, import.meta.url), "utf8")));
test("both datasets have unique sourced companies, valid topology and honest coverage counts", () => {
  graphs.forEach(validateGraph);
  assert.equal(graphs[0].coverage.companyCount, 67);
  assert.equal(graphs[1].coverage.companyCount, 62);
  assert(graphs[0].nodes.some(n => n.id === "US:P"));
  assert(!graphs[0].nodes.some(n => n.id === "US:PSTG"));
});
test("rejects broken evidence, cross-market endpoints, and commercial stage edges", () => {
  for (const mutation of [
    (g: Graph) => { g.relationships[0].sourceIds = ["missing"]; },
    (g: Graph) => { g.relationships[0].source = "XSHG:688041"; },
    (g: Graph) => { g.relationships[0].type = "SUPPLIER_OF"; },
    (g: Graph) => { g.relationships.push(g.relationships[0]); },
    (g: Graph) => { g.sources[0].url = "https://username:password@example.com"; },
    (g: Graph) => { g.coverage.companyCount++; },
    (g: Graph) => { g.relationships.find(e => e.type === "PLANNED_ADOPTER_OF")!.commercialStatus = "DOCUMENTED"; },
  ]) { const copy = structuredClone(graphs[0]); mutation(copy); assert.throws(() => validateGraph(copy)); }
});
test("version hash is reproducible and changes with research content", () => {
  assert.deepEqual(graphVersion(graphs[0]), graphVersion(structuredClone(graphs[0])));
  const copy = structuredClone(graphs[0]); copy.title += " revised";
  assert.notEqual(graphVersion(copy).versionId, graphVersion(graphs[0]).versionId);
});


function fakeDb() {
  const records = new Map<string, Record<string, unknown>>(); let fail = true;
  type Ref = { id:string; path:string };
  const snapshot=(ref:Ref)=>({exists:records.has(ref.path),data:()=>records.get(ref.path)});
  const db = {
    collection:(name:string)=>({doc:(id:string)=>({id,path:name+"/"+id})}),
    runTransaction:async(callback:(tx:unknown)=>Promise<void>)=>{
      const writes:{ref:Ref;data:Record<string,unknown>}[]=[];
      await callback({getAll:async(...refs:Ref[])=>refs.map(snapshot),set:(ref:Ref,data:Record<string,unknown>)=>writes.push({ref,data})});
      if(fail)throw Error("Simulated transaction interruption");
      for(const {ref,data} of writes) records.set(ref.path,{...records.get(ref.path),...data});
    },
  } as unknown as Firestore;
  return {db,records,resume:()=>{fail=false;}};
}
test("atomic master import preserves both markets, evidence, publication state and reviewed edits on replay",async()=>{
  const f=fakeDb();
  await assert.rejects(importGraphs(f.db,graphs),/Simulated/);
  assert.equal(f.records.size,0);
  f.resume();
  await importGraphs(f.db,graphs);
  const companies=[...f.records].filter(([p])=>p.startsWith("market_companies/")).map(([p,d])=>({...d,id:p.split("/")[1]}) as MarketCompany);
  const edges=[...f.records].filter(([p])=>p.startsWith("market_company_relationships/")).map(([p,d])=>({...d,id:p.split("/")[1]}) as MarketRelationship);
  const map=graphFromMarket(companies,edges);
  assert.equal(map.nodes.filter(n=>n.kind==="COMPANY").length,129);
  assert.equal(map.relationships.filter(e=>e.type!=="PARTICIPATES_IN").length,31);
  for(const g of graphs)for(const source of g.sources)assert(map.sources.some(s=>s.url===source.url&&s.title===source.title),source.id);
  assert(map.nodes.find(n=>n.id==="stage:compute")?.labels?.["zh-CN"]);
  const companyPath="market_companies/US:NVDA", old=f.records.get(companyPath)!;
  f.records.set(companyPath,{...old,name:"Reviewed NVIDIA",description:"Reviewed description"});
  const edgePath=[...f.records.keys()].find(p=>p.startsWith("market_company_relationships/"))!;
  f.records.set(edgePath,{...f.records.get(edgePath),status:"WITHDRAWN"});
  const count=f.records.size;
  await importGraphs(f.db,graphs);
  assert.equal(f.records.size,count);
  assert.equal(f.records.get(companyPath)?.name,"Reviewed NVIDIA");
  assert.equal(f.records.get(edgePath)?.status,"WITHDRAWN");
});
test("new published master relationships bring in public neighbors; drafts, missing endpoints and unrelated companies stay out",()=>{
  const seed={id:"US:NVDA",name:"NVIDIA",status:"PUBLISHED",aiGraph:{status:"PUBLISHED",stageIds:["compute"],stages:[{id:"stage:compute",kind:"STAGE",order:1}],sources:[],memberships:[],order:1,asOf:"2026-09-11"}} as MarketCompany;
  const evidence=[{id:"report",url:"https://example.com/report",title:"Report",sourceDate:null,summary:"Supplies hardware"}];
  const edge={id:"r",source:"US:NVDA",target:"US:NEW",type:"SUPPLIER_OF",status:"PUBLISHED",evidence};
  const companies=[seed,{id:"US:NEW",name:"New company",status:"DIRECTORY"},{id:"US:PRIVATE",name:"Private",status:"DRAFT"},{id:"US:OTHER",name:"Unrelated",status:"PUBLISHED"}];
  const map=graphFromMarket(companies,[edge,{...edge,id:"private",target:"US:PRIVATE"},{...edge,id:"draft",status:"DRAFT",target:"US:OTHER"}]);
  assert.deepEqual(map.nodes.filter(n=>n.kind==="COMPANY").map(n=>n.id),["US:NVDA","US:NEW"]);
  assert.equal(map.relationships.length,1);
  assert.equal(map.sources[0].url,evidence[0].url);
});
