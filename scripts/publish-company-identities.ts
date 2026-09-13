import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { profileDate, profileUrl } from "../src/lib/company-profile";
import type { CompanyListing } from "../src/lib/market-companies/identity";

type Evidence = { url: string; excerpt: string; basis?: string };
export type IdentityBatch = { asOf: string; companies: {
  id: string; expectedName: string; country: string; listingStatus: "PUBLIC";
  listings: CompanyListing[]; evidence: { country: Evidence; listing: Evidence };
}[] };
export function validateIdentities(batch: IdentityBatch) {
  assert(profileDate(batch.asOf) && batch.asOf <= new Date().toISOString().slice(0, 10), "Invalid research date");
  assert(batch.companies.length > 0 && batch.companies.length <= 200, "Invalid batch size");
  assert(new Set(batch.companies.map(c => c.id)).size === batch.companies.length, "Duplicate company IDs");
  for (const c of batch.companies) {
    assert(/^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(c.id) && c.expectedName.trim(), "Invalid identity");
    assert(/^[A-Z]{2}$/.test(c.country) && c.listingStatus === "PUBLIC", `${c.id}: invalid geography/status`);
    assert(c.listings.length > 0 && c.listings.every(l => l.market === (c.id.startsWith("US:") ? "US" : "CN_A") && l.symbol === c.id.split(":")[1] && (c.id.startsWith("US:") ? ["XNAS", "XNYS"].includes(l.exchange) : l.exchange === c.id.split(":")[0])), `${c.id}: listing does not match company`);
    for (const e of [c.evidence.country, c.evidence.listing]) assert(profileUrl(e.url)?.startsWith("https://") && e.excerpt.trim(), `${c.id}: invalid evidence`);
    assert(["BUSINESS_ADDRESS", "OFFICE", "HEADQUARTERS", "CORPORATE_CAMPUS"].includes(c.evidence.country.basis ?? ""), `${c.id}: missing country basis`);
  }
}
export async function publishIdentities(db: Firestore, batch: IdentityBatch, write = false) {
  validateIdentities(batch);
  return db.runTransaction(async tx => {
    const refs = batch.companies.map(c => db.collection("companies").doc(c.id));
    const docs = await tx.getAll(...refs);
    const updates = batch.companies.map((c, i) => {
      const old = docs[i].data();
      assert(old && old.name === c.expectedName, `${c.id}: missing company or identity changed`);
      assert(["DIRECTORY", "PUBLISHED"].includes(old.status), `${c.id}: company is not public`);
      assert(!old.country || old.country === c.country, `${c.id}: country conflict`);
      assert(!old.listingStatus || ["UNKNOWN", "PUBLIC"].includes(old.listingStatus), `${c.id}: listing status conflict`);
      assert(!old.identityReviewedAt || old.identityReviewedAt <= batch.asOf, `${c.id}: newer identity exists`);
      assert(!old.listings || Array.isArray(old.listings), `${c.id}: malformed existing listings`);
      const listings: CompanyListing[] = [...(old.listings ?? [])];
      for (const l of c.listings) {
        assert(!listings.some(existing => existing.exchange === l.exchange && existing.symbol === l.symbol && existing.market !== l.market), `${c.id}: listing market conflict`);
        if (!listings.some(existing => existing.exchange === l.exchange && existing.symbol === l.symbol)) listings.push(l);
      }
      return { country: c.country, listingStatus: c.listingStatus, listings, identityReviewedAt: batch.asOf, identityEvidence: { ...(old.identityEvidence ?? {}), ...c.evidence, checkedAt: batch.asOf } };
    });
    if (write) updates.forEach((update, i) => tx.update(refs[i], update));
    return { write, companies: refs.length, collection: "companies", countries: [...new Set(updates.map(c => c.country))].sort() };
  }, write ? { readOnly: false } : { readOnly: true });
}
async function main() {
  const batch = JSON.parse(await readFile(new URL("../data/ai-supply-chain/company-identities.json", import.meta.url), "utf8"));
  validateIdentities(batch);
  if (process.argv.includes("--validate")) { console.log(`Validated ${batch.companies.length} company identities`); return; }
  assert(process.env.GCP_PROJECT_ID && (process.argv.includes("--preview") || process.argv.includes("--write")), "Use --validate, --preview or --write with GCP_PROJECT_ID");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  console.log(JSON.stringify(await publishIdentities(getFirestore(), batch, process.argv.includes("--write"))));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error ? error.message : "Identity publication failed"); process.exitCode = 1; });
