import assert from "node:assert/strict";
import { mkdir, open, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, type CollectionReference, type DocumentReference } from "firebase-admin/firestore";
import { getSecurityRules } from "firebase-admin/security-rules";
import { assertIdentical, encode, fingerprint, protectCompanies } from "./firestore/exact-copy";

const collections = { market_companies: "companies", market_company_relationships: "company_relationships" } as const;
const backup = "output/company-collection-rename";

async function main() {
  assert(process.env.GCP_PROJECT_ID && process.argv.includes("--write"), "Use --write with GCP_PROJECT_ID");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
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
          const snapshots = await db.getAll(...refs);
          const existing = snapshots.filter(doc => doc.exists);
          const copies = verifyDestination && existing.length ? await db.getAll(...existing.map(doc => db.doc(target(doc.ref.path)))) : [];
          for (const [index, doc] of existing.entries()) {
            const data = doc.data()!;
            hashes.set(doc.ref.path, fingerprint(data));
            if (file) await file.writeFile(JSON.stringify({ path: doc.ref.path, data: encode(data) }) + "\n");
            if (verifyDestination) {
              if (copies[index].exists) assertIdentical(data, copies[index].data(), copies[index].ref.path);
              else if (!copy && !allowMissing) throw new Error(`Missing destination: ${copies[index].ref.path}`);
            }
          }
          if (copy) {
            const batch = db.batch();
            let count = 0;
            existing.forEach((doc, index) => {
              if (!copies[index].exists) { batch.create(db.doc(target(doc.ref.path)), doc.data()!); count++; }
            });
            if (count) await batch.commit();
          }
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
    const live = await fetch("https://youanalyst.com/api/knowledge-graph?rename=" + Date.now(), { signal: AbortSignal.timeout(30000) });
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
      const destinations = (await db.getAll(...refs)).filter(doc => doc.exists);
      if (!destinations.length) return;
      const originals = await db.getAll(...destinations.map(doc => db.doc([source, ...doc.ref.path.split("/").slice(1)].join("/"))));
      destinations.forEach((doc, index) => {
        assert(originals[index].exists, `Destination contains unrelated data: ${doc.ref.path}; inspect before renaming`);
        assertIdentical(originals[index].data(), doc.data(), doc.ref.path);
      });
    });
  }
  const before = await scan(false, true, true, true);
  assert(before.count > 0, "No source data found; refusing to initialize unrelated data");
  await writeFile(`${backup}/manifest.json`, JSON.stringify({ collections, ...before, exportedAt: new Date().toISOString() }, null, 2));

  // Patch the current release, not an entire potentially stale local rules file.
  const security = getSecurityRules();
  const live = await security.getFirestoreRuleset();
  assert.equal(live.source.length, 1, "Inspect multi-file security rules before migration");
  const source = live.source[0].content;
  await writeFile(`${backup}/firestore.rules.before`, source);
  const protectedSource = protectCompanies(source);
  if (protectedSource !== source) await security.releaseFirestoreRulesetFromSource(protectedSource);

  const copied = await scan(true, true);
  assert.equal(copied.hash, before.hash, "Source changed during copy; existing production reader remains active");
  const verified = await scan(false, true);
  assert.equal(verified.hash, before.hash, "Source changed during verification; retry after writes finish");
  await marker.set({ sourceHash: before.hash, count: before.count, copiedAt: new Date().toISOString() });
  console.log(`Exact copy verified: ${before.count} documents; IDs, fields and subcollections preserved.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Collection rename failed"); process.exitCode = 1; });
