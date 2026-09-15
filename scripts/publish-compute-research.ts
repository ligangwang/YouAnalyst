import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { processBatch, validateBatch, type ComputeBatch, type Plan } from "../src/lib/research/publisher";
export { canonical, hash, mergeEdge, processBatch, validateBatch, type ComputeBatch } from "../src/lib/research/publisher";
async function main() {
  const b = JSON.parse(await readFile(new URL("../data/ai-supply-chain/compute-research.json", import.meta.url), "utf8")) as ComputeBatch;
  validateBatch(b);
  if (process.argv.includes("--validate")) { console.log(`Validated ${b.relationships.length} relationships`); return; }
  assert(process.env.GCP_PROJECT_ID && ["--preview", "--write", "--verify"].some(f => process.argv.includes(f)));
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const approved = process.argv.includes("--write") ? JSON.parse(await readFile("compute-preview.json", "utf8")) as Plan : undefined;
  const plan = await processBatch(getFirestore(), b, approved);
  if (process.argv.includes("--verify")) assert(plan.changes.every(c => !c.changed), "Publication incomplete or not idempotent");
  const file = approved ? "compute-written.json" : process.argv.includes("--verify") ? "compute-verified.json" : "compute-preview.json";
  await writeFile(file, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ operation: approved ? "write" : process.argv.includes("--verify") ? "verify" : "preview", relationships: plan.changes.length, additions: plan.changes.filter(c => !c.before).length, updates: plan.changes.filter(c => c.before && c.changed).length, unchanged: plan.changes.filter(c => !c.changed).length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e instanceof Error ? e.message : "Publication failed"); process.exitCode = 1; });
