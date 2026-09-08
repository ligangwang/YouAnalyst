import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { INDUSTRY_STARTERS } from "../src/lib/industry-graph/catalog";

async function main() {
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
let created = 0;
for (const company of INDUSTRY_STARTERS) {
  const ref = db.collection("industry_map_companies").doc(company.ticker);
  const added = await db.runTransaction(async (transaction) => {
    if ((await transaction.get(ref)).exists) return false;
    transaction.create(ref, { ...company, featured: true, createdAt: new Date().toISOString() });
    return true;
  });
  if (added) created++;
}
console.log(`Company map directory: created ${created} initial metadata records; existing records preserved.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
