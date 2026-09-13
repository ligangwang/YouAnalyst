import assert from "node:assert/strict";
import { mkdir, open, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, type CollectionReference, type DocumentReference } from "firebase-admin/firestore";
import { v1 } from "@google-cloud/firestore";
import type { google } from "@google-cloud/firestore/types/protos/firestore_v1_proto_api";
import { getSecurityRules } from "firebase-admin/security-rules";
import { assertIdentical, encode, fingerprint, protectCompanies, reviewedDefaultDeny } from "./firestore/exact-copy";

const collections = { market_companies: "companies", market_company_relationships: "company_relationships" } as const;
type Fields = NonNullable<google.firestore.v1.IDocument["fields"]>;
const backup = "output/company-collection-rename";

async function main() {
  assert(process.env.GCP_PROJECT_ID && process.argv.includes("--write"), "Use --write with GCP_PROJECT_ID");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
  const raw = new v1.FirestoreClient();
  const database = `projects/${process.env.GCP_PROJECT_ID}/databases/${db.databaseId}`;
  async function readRaw(refs: DocumentReference[]): Promise<Map<string, Fields>> {
    const result = new Map<string, Fields>();
    const seen = new Set<string>();
    const stream = raw.batchGetDocuments({ database, documents: refs.map(ref => `${database}/documents/${ref.path}`) });
    for await (const response of stream as AsyncIterable<google.firestore.v1.IBatchGetDocumentsResponse>) {
      const name = response.found?.name ?? response.missing;
      if (!name) continue;
      const path = name.slice((database + "/documents/").length);
      seen.add(path);
      if (response.found) result.set(path, response.found.fields ?? {});
    }
    assert(refs.every(ref => seen.has(ref.path)), "Incomplete raw Firestore read");
    return result;
  }
  async function createRaw(records: [string, Fields][]) {
    let writes: google.firestore.v1.IWrite[] = [], bytes = 0;
    async function flush() {
      if (writes.length) await raw.commit({ database, writes });
      writes = []; bytes = 0;
    }
    for (const [path, fields] of records) {
      const write = { update: { name: `${database}/documents/${target(path)}`, fields }, currentDocument: { exists: false } };
      const size = Buffer.byteLength(JSON.stringify(write));
      if (bytes + size > 5_000_000) await flush();
      writes.push(write); bytes += size;
    }
    await flush();
  }
  const marker = db.collection("directory_syncs").doc("company_collection_names_v1");
  const saved = (await marker.get()).data();
  if (saved?.completedAt) {
    console.log("Collection rename already verified; existing data was not touched.");
    return;
  }

  // listDocuments includes missing parent documents that still have subcollections.
  // Fetch and copy in small groups; don't retain the company directory in memory.
  async function visit(collection: CollectionReference, callback: (refs: DocumentReference[]) => Promise<void>) {
    const refs = await collection.listDocuments();
    for (let i = 0; i < refs.length; i += 30) {
      const group = refs.slice(i, i + 30);
      await callback(group);
      const children = await Promise.all(group.map(ref => ref.listCollections()));
      for (const child of children.flat()) await visit(child, callback);
    }
  }
  function target(path: string) {
    const [root, ...rest] = path.split("/");
    assert(root in collections, "Unexpected source path");
    return [collections[root as keyof typeof collections], ...rest].join("/");
  }
  async function scan(copy: boolean, verifyDestination: boolean, exportData = false, allowMissing = false) {
    const hashes = new Map<string, string>();
    const file = exportData ? await open(`${backup}/documents.jsonl`, "w") : null;
    try {
      for (const source of Object.keys(collections)) {
        await visit(db.collection(source), async refs => {
          const existing = await readRaw(refs);
          const copies = verifyDestination && existing.size ? await readRaw([...existing.keys()].map(path => db.doc(target(path)))) : new Map<string, Fields>();
          for (const [path, fields] of existing) {
            hashes.set(path, fingerprint(fields));
            if (file) await file.writeFile(JSON.stringify({ path, fields: encode(fields) }) + "\n");
            if (verifyDestination) {
              if (copies.has(target(path))) assertIdentical(fields, copies.get(target(path)), target(path));
              else if (!copy && !allowMissing) throw new Error(`Missing destination: ${target(path)}`);
            }
          }
          if (copy) await createRaw([...existing].filter(([path]) => !copies.has(target(path))));
        });
        console.log(`Scanned ${source}: ${hashes.size} documents so far`);
      }
    } finally { await file?.close(); }
    return { count: hashes.size, hash: createHash("sha256").update(JSON.stringify([...hashes].sort(([a], [b]) => a.localeCompare(b)))).digest("hex") };
  }

  if (process.argv.includes("--verify-source")) {
    assert(saved?.sourceHash, "Verified copy required before cutover verification");
    const current = await scan(false, false);
    assert.equal(current.hash, saved.sourceHash, "Source changed during release; retain both collections and investigate before cleanup");
    assert(process.env.RENAME_BASE_URL, "RENAME_BASE_URL required for cutover verification");
    const live = await fetch(new URL("/api/knowledge-graph?rename=" + Date.now(), process.env.RENAME_BASE_URL), { signal: AbortSignal.timeout(30000) });
    assert(live.ok && live.headers.get("x-graph-storage") === "company_relationships", "New production reader must be live");
    await marker.set({ completedAt: new Date().toISOString() }, { merge: true });
    console.log(`Verified unchanged source: ${current.count} documents. Original collections retained for recovery.`);
    return;
  }

  await mkdir(backup, { recursive: true });
  // A new name may already belong to legacy data. Never overwrite it.
  // This pass exports the source before any copy and checks every collision.
  for (const [source, destination] of Object.entries(collections)) {
    console.log(`${destination} existing documents: ${(await db.collection(destination).count().get()).data().count}`);
    await visit(db.collection(destination), async refs => {
      const destinations = await readRaw(refs);
      if (!destinations.size) return;
      const originalPath = (path: string) => [source, ...path.split("/").slice(1)].join("/");
      const originals = await readRaw([...destinations.keys()].map(path => db.doc(originalPath(path))));
      for (const [path, fields] of destinations) {
        assert(originals.has(originalPath(path)), `Destination contains unrelated data: ${path}; inspect before renaming`);
        assertIdentical(originals.get(originalPath(path)), fields, path);
      }
    });
  }
  const before = await scan(false, true, true, true);
  assert(before.count > 0, "No source data found; refusing to initialize unrelated data");
  await writeFile(`${backup}/manifest.json`, JSON.stringify({ collections, ...before, exportedAt: new Date().toISOString() }, null, 2));

  // Patch the current release, not an entire potentially stale local rules file.
  const reviewed = reviewedDefaultDeny(saved?.rulesReview, process.env.GCP_PROJECT_ID);
  if (reviewed) {
    await writeFile(`${backup}/firestore.rules.before`, reviewed);
    await writeFile(`${backup}/rules-review.json`, saved!.rulesReview);
    console.log("Using recent owner console review of default-deny rules; no rule or IAM changes.");
  } else {
    const security = getSecurityRules();
    const live = await security.getFirestoreRuleset();
    assert.equal(live.source.length, 1, "Inspect multi-file security rules before migration");
    const source = live.source[0].content;
    await writeFile(`${backup}/firestore.rules.before`, source);
    const protectedSource = protectCompanies(source);
    if (protectedSource !== source) await security.releaseFirestoreRulesetFromSource(protectedSource);
  }

  const copied = await scan(true, true);
  assert.equal(copied.hash, before.hash, "Source changed during copy; existing production reader remains active");
  const verified = await scan(false, true);
  assert.equal(verified.hash, before.hash, "Source changed during verification; retry after writes finish");
  await marker.set({ sourceHash: before.hash, count: before.count, copiedAt: new Date().toISOString() }, { merge: true });
  console.log(`Exact copy verified: ${before.count} documents; IDs, fields and subcollections preserved.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Collection rename failed"); process.exitCode = 1; });
