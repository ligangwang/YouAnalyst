import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "../src/lib/firebase/firestore";
import { validFundamentalsTicker } from "../src/lib/fundamentals/identity";
import { copyLegacyFundamentals } from "../src/lib/fundamentals/migrate-ids";

async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) if (!["--apply", "--writers-paused"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  const apply = args.has("--apply");
  if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID must explicitly select the migration project");
  if (apply && !args.has("--writers-paused")) throw new Error("Pause all legacy readers/writers and deliveries before applying; then pass --writers-paused");
  initializeApp({credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID});
  const db = getFirestore();
  const counts: Record<string, number> = {};
  let cursor: string | undefined;
  // Legacy tickers begin with a digit or uppercase letter. Exclude '_' operational
  // records on the server; ignore canonical US/CN keys after reading their IDs.
  while (true) {
    let query = db.collection("company_fundamentals").orderBy(FieldPath.documentId())
      .startAt("0").endBefore("[").select().limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      cursor = doc.id;
      if (!validFundamentalsTicker(doc.id)) continue;
      const status = await copyLegacyFundamentals(db, doc.id, apply);
      counts[status] = (counts[status] ?? 0) + 1;
      console.log(JSON.stringify({ ticker: doc.id, status }));
    }
    if (page.size < 100) break;
  }
  console.log(JSON.stringify({ project: process.env.GCP_PROJECT_ID, apply, counts }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
