import test from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { publishNames, validateNames, type NameBatch } from "../scripts/publish-company-names";
import { companyName, companySearchText, matchesCompanySearch } from "../src/lib/knowledge-graph/model";
import { graphFromMarket } from "../src/lib/knowledge-graph/market-store";
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
