import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { companyFields } from "../src/lib/market-companies/model";

export type NameBatch = { asOf: string; companies: { id: string; expectedName: string; names: {en:string; "zh-CN":string}; sourceUrl: string }[] };
export function validateNames(batch: NameBatch) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(batch.asOf) && batch.asOf <= new Date().toISOString().slice(0,10), "Invalid date");
  assert(batch.companies.length > 0 && batch.companies.length <= 200, "Invalid batch size");
  assert(new Set(batch.companies.map(c=>c.id)).size === batch.companies.length, "Duplicate company");
  for(const c of batch.companies){
    assert(/^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9.-]+)$/.test(c.id) && c.expectedName.trim(), "Invalid company");
    for(const locale of ["en","zh-CN"] as const) assert(typeof c.names[locale] === "string" && c.names[locale].trim() && c.names[locale].length <= 200, "Invalid localized name");
    const url = new URL(c.sourceUrl); assert(url.protocol === "https:" && !url.username && !url.password, "Invalid source");
  }
}
export async function publishNames(db: Firestore, batch: NameBatch, write=false){
  validateNames(batch);
  return db.runTransaction(async tx=>{
    const refs=batch.companies.map(c=>db.collection("companies").doc(c.id));
    const docs=await tx.getAll(...refs);
    const updates=batch.companies.map((c,i)=>{
      const old=docs[i].data();
      assert(old && old.name === c.expectedName, `${c.id}: company identity changed or missing`);
      assert(["PUBLISHED","DIRECTORY"].includes(old.status), `${c.id}: unpublished company`);
      const previous=old.names ?? {};
      assert(previous && typeof previous === "object" && !Array.isArray(previous), "Invalid existing names");
      for(const locale of ["en","zh-CN"] as const) assert(!previous[locale] || previous[locale]===c.names[locale], `${c.id}: existing translation conflict`);
      const names={...previous,...c.names};
      return {names, nameEvidence:{...(old.nameEvidence ?? {}),sourceUrl:c.sourceUrl,checkedAt:batch.asOf},searchPrefixes:companyFields(c.id,{...old,names}).searchPrefixes};
    });
    if(write) updates.forEach((update,i)=>tx.update(refs[i],update));
    return {write,companies:updates.length,collection:"companies"};
  },write ? {readOnly:false}:{readOnly:true});
}
async function main(){
 const batch=JSON.parse(await readFile(new URL("../data/ai-supply-chain/company-names.json",import.meta.url),"utf8"));
 validateNames(batch);
 if(process.argv.includes("--validate")){console.log(`Validated ${batch.companies.length} bilingual company names`);return;}
 assert(process.env.GCP_PROJECT_ID && (process.argv.includes("--preview")||process.argv.includes("--write")),"Use --validate, --preview or --write with GCP_PROJECT_ID");
 initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
 console.log(JSON.stringify(await publishNames(getFirestore(),batch,process.argv.includes("--write"))));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e instanceof Error?e.message:"Name publication failed");process.exitCode=1;});
