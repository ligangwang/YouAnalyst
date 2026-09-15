import test from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { publishNames, validateNames, type NameBatch } from "../scripts/publish-company-names";
import { companyName, companySearchText, matchesCompanySearch } from "../src/lib/knowledge-graph/model";
import { graphFromMarket } from "../src/lib/knowledge-graph/market-store";
import { editCompanyName, parseNameEdit } from "../src/lib/market-companies/edit-name";
import { build } from "esbuild";
import { createRequire } from "node:module";
const batch:NameBatch={asOf:"2026-09-14",companies:[{id:"US:NVDA",expectedName:"NVIDIA",names:{en:"NVIDIA","zh-CN":"英伟达"},sourceUrl:"https://www.nvidia.cn/newsroom/"}]};
test("localized names survive projection and both names and aliases are searchable",()=>{
 const graph=graphFromMarket([{id:"US:NVDA",name:"NVIDIA",status:"PUBLISHED",names:{en:"NVIDIA","zh-CN":"英伟达",invalid:17},aliases:["辉达",17],aiGraph:{status:"PUBLISHED",stageIds:["compute"],stages:[],memberships:[],sources:[],order:0,asOf:"2026-09-14"}}],[]);
 const node=graph.nodes[0];
 assert.equal(companyName(node,"zh-CN"),"英伟达");assert.equal(companyName(node,"en"),"NVIDIA");
 assert.equal(companyName({...node,names:{en:" "}},"en"),"NVIDIA");
 for(const query of ["英伟达","NVIDIA","辉达","nvda"])assert(matchesCompanySearch(companySearchText(graph,node),query));
 assert.deepEqual(node.names,{en:"NVIDIA","zh-CN":"英伟达"});
});
function fake(old:Record<string,unknown>|undefined){
 const writes:Record<string,unknown>[]=[];
 const db={collection:(name:string)=>{assert.equal(name,"companies");return {doc:(id:string)=>({id})};},runTransaction:async(fn:(tx:unknown)=>unknown)=>fn({getAll:async()=>[{data:()=>old}],update:(_ref:unknown,data:Record<string,unknown>)=>writes.push(data)})} as unknown as Firestore;
 return {db,writes};
}
test("publication only updates existing names, evidence and search index and preview writes nothing",async()=>{
 const f=fake({name:"NVIDIA",status:"PUBLISHED",names:{fr:"NVIDIA"},description:"Keep",aiGraph:{status:"PUBLISHED"}});
 await publishNames(f.db,batch,false);assert.equal(f.writes.length,0);
 await publishNames(f.db,batch,true);assert.equal(f.writes.length,1);
 assert.deepEqual(Object.keys(f.writes[0]).sort(),["nameEvidence","names","searchPrefixes"]);
 assert.deepEqual(f.writes[0].names,{fr:"NVIDIA",en:"NVIDIA","zh-CN":"英伟达"});
 assert((f.writes[0].searchPrefixes as string[]).includes("英伟达"));
});
test("missing identities and conflicting translations abort without writes",async()=>{
 for(const old of [undefined,{name:"Other",status:"PUBLISHED"},{name:"NVIDIA",status:"PUBLISHED",names:{"zh-CN":"Different"}}]){
  const f=fake(old);await assert.rejects(publishNames(f.db,batch,true));assert.equal(f.writes.length,0);
 }
 assert.throws(()=>validateNames({...batch,companies:[...batch.companies,...batch.companies]}));
});

test("admin correction preserves identity and aliases, updates search and invalidates shared caches", async () => {
 const old = { name: "Taiwan Semiconductor Manufacturing", status: "PUBLISHED", names: { en: "TSMC", "zh-CN": "台积公司" }, aliases: ["台積電"] };
 const writes: { path: string; data: Record<string, unknown> }[] = [];
 const db = { collection: (collection: string) => ({ doc: (id: string) => ({ path: `${collection}/${id}` }) }), runTransaction: async (fn: (tx: unknown) => unknown) => fn({ get: async () => ({ data: () => old }), update: (ref: {path:string}, data: Record<string, unknown>) => writes.push({path:ref.path,data}), set: (ref: {path:string}, data: Record<string, unknown>) => writes.push({path:ref.path,data}) }) } as unknown as Firestore;
 const input = { companyId: "US:TSM", locale: "zh-CN", name: "台积电", expectedName: "台积公司" };
 const result = await editCompanyName(db, input, "admin");
 assert.equal(result.names["zh-CN"], "台积电");
 assert.equal(result.names.en, "TSMC");
 assert.deepEqual(result.aliases, ["台積電", "台积公司"]);
 assert.equal(writes[0].path, "companies/US:TSM");
 assert.equal("name" in writes[0].data, false);
 assert((writes[0].data.searchPrefixes as string[]).includes("台积电"));
 assert((writes[0].data.searchPrefixes as string[]).includes("台积公司"));
 assert.equal((writes[0].data["nameEdits.zh-CN"] as {editedBy:string}).editedBy, "admin");
 assert.equal(writes[1].path, "directory_syncs/company_names");
 writes.length = 0;
 await assert.rejects(editCompanyName(db, {...input, expectedName: "stale"}, "admin"), {status:409});
 assert.equal(writes.length, 0);
 await editCompanyName(db, {...input, name: "台积公司"}, "admin");
 assert.equal(writes.length, 0);
});

test("name API validates scope, bounded plain text and requires authentication", async () => {
 const good = {companyId:"US:TSM", locale:"zh-CN", name:"台积电", expectedName:"台积公司"};
 for (const bad of [null, [], {...good, companyId:"../users"}, {...good, locale:"role"}, {...good, admin:true}, {...good, name:" "}, {...good, name:"<script>"}, {...good, name:"a".repeat(121)}, {...good, name:"a\u202Eb"}]) assert.throws(() => parseNameEdit(bad));
 const { PATCH } = await import("../src/app/api/admin/company-names/route");
 const { NextRequest } = await import("next/server");
 const response = await PATCH(new NextRequest("https://example.com/api/admin/company-names", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(good) }));
 assert.equal(response.status,401);
 assert.equal(response.headers.get("cache-control"), "private, no-store");
});

async function isolatedModule(entry: string, fixture: object) {
 const bundle = await build({entryPoints:[entry],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"firebase-fixture",setup(builder){
  builder.onLoad({filter:/[\\/]firebase[\\/]admin\.ts$/},()=>({contents:"export const getAdminFirestore = () => fixture.db;",loader:"js"}));
  builder.onLoad({filter:/[\\/]firebase[\\/]auth\.ts$/},()=>({contents:"export const getDecodedUserFromRequest = async () => fixture.user;",loader:"js"}));
  builder.onLoad({filter:/[\\/]firebase[\\/]admin-role\.ts$/},()=>({contents:"export const isAdminUser = async () => fixture.admin;",loader:"js"}));
 }}]});
 const testModule = {exports:{} as Record<string, (...args: never[]) => Promise<unknown>>};
 new Function("fixture","require","module",bundle.outputFiles[0].text)(fixture,createRequire(import.meta.url),testModule);
 return testModule.exports;
}

test("non-admin name edits fail before any database access", async () => {
 const route = await isolatedModule("src/app/api/admin/company-names/route.ts", {user:{uid:"ordinary"},admin:false,get db(){throw new Error("Must not access database");}});
 const response = await route.PATCH(new Request("https://example.com",{method:"PATCH"}) as never) as Response;
 assert.equal(response.status,403);
});

test("shared name revision invalidates warm graph caches in separate server instances", async () => {
 let revision = "old", name = "台积公司", companyReads = 0;
 const db = {collection:(collection:string)=>({
  doc:()=>({get:async()=>({data:()=>({revision})})}),
  where:()=>({get:async()=>({docs:collection === "companies" ? [ {id:"US:TSM",data:()=>{companyReads++;return {name:"TSMC",names:{"zh-CN":name},status:"PUBLISHED",aiGraph:{status:"PUBLISHED",stageIds:[],stages:[],memberships:[],sources:[]}};}} ] : []})})
 })};
 const a = await isolatedModule("src/lib/knowledge-graph/service.ts",{db});
 const b = await isolatedModule("src/lib/knowledge-graph/service.ts",{db});
 for(const server of [a,b]) assert.equal(companyName((await server.loadKnowledgeGraph() as ReturnType<typeof graphFromMarket>).nodes[0],"zh-CN"),"台积公司");
 await a.loadKnowledgeGraph(); await b.loadKnowledgeGraph(); assert.equal(companyReads,2);
 name = "台积电"; revision = "new";
 for(const server of [a,b]) assert.equal(companyName((await server.loadKnowledgeGraph() as ReturnType<typeof graphFromMarket>).nodes[0],"zh-CN"),"台积电");
 assert.equal(companyReads,4);
});
