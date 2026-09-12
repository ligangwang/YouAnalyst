import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { COMPANY_COLLECTION, companyFields } from "../src/lib/market-companies/model";

async function main() {
if (!process.argv.includes("--write") || !process.env.GCP_PROJECT_ID) throw new Error("Use --write with GCP_PROJECT_ID");
initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
const db = getFirestore();
const marker = db.collection("directory_syncs").doc("market_companies_v1");
if ((await marker.get()).exists) { console.log("Company master migration already complete"); process.exit(0); }
const existing = await db.collection(COMPANY_COLLECTION).get();
const rows = new Map(existing.docs.map(d => [d.id, d.data()]));
const [tickers, directory] = await Promise.all([db.collection("tickers").get(),db.collection("company_directory").get()]);
const us = new Map<string, FirebaseFirestore.DocumentData>();
for (const doc of tickers.docs) {
  const r = doc.data();
  if (!r.symbol || !r.name || r.active !== true || r.predictionSupported !== true) continue;
  const id = `US:${r.symbol}`;
  if (!us.has(id) || Number(r.exchangePriority ?? 0) > Number(us.get(id)!.exchangePriority ?? 0)) us.set(id, r);
}
for (const [id, r] of us) rows.set(id, {...rows.get(id), ...r, id, market:"US"});
for (const doc of directory.docs) {
  const r = doc.data();
  if (r.market !== "CN_A") continue;
  rows.set(doc.id, { ...r, sourceLabel:`国证行业分类 ${r.snapshot ?? ""}`, ...rows.get(doc.id), symbol:doc.id.split(":")[1] });
}
let count = 0;
const entries = [...rows.entries()];
for (let offset=0; offset<entries.length; offset+=200) {
  const batch=db.batch();
  for (const [id,r] of entries.slice(offset,offset+200)) {
    if (!/^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(id) || !r.name) continue;
    batch.set(db.collection(COMPANY_COLLECTION).doc(id), {...r,status:r.status ?? "DIRECTORY",...companyFields(id,r)}, {merge:true}); count++;
  }
  await batch.commit();
}
console.log(JSON.stringify({collection:COMPANY_COLLECTION,written:count,us:us.size,aShares:directory.size}));
await marker.set({completedAt:new Date().toISOString(),count});

}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Company migration failed'); process.exitCode = 1; });

