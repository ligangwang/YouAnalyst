import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { normalizeCompanyProfile, profileDate, type CompanyProfile } from "../src/lib/company-profile";

export type ProfileBatch = { asOf: string; companies: { id: string; expectedName: string; profile: CompanyProfile }[] };
export function validateProfiles(batch: ProfileBatch) {
  assert(profileDate(batch.asOf) && batch.asOf <= new Date().toISOString().slice(0, 10), "Invalid research date");
  assert(batch.companies.length > 0 && batch.companies.length <= 200, "Invalid batch size");
  assert(new Set(batch.companies.map(c => c.id)).size === batch.companies.length, "Duplicate company IDs");
  for (const c of batch.companies) {
    assert(/^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(c.id) && c.expectedName.trim(), "Invalid identity");
    const normalized = normalizeCompanyProfile(c.profile);
    assert(normalized && c.profile.checkedAt === batch.asOf, `${c.id}: invalid profile`);
    // Reject discarded unsafe fields rather than silently publishing a partial proposal.
    for (const field of ["website", "investorRelations", "disclosures", "location", "financialReport"] as const) {
      assert(!c.profile[field] || normalized[field], `${c.id}: invalid ${field}`);
    }
  }
}
export async function publishProfiles(db: Firestore, batch: ProfileBatch, write = false) {
  validateProfiles(batch);
  return db.runTransaction(async tx => {
    const refs = batch.companies.map(c => db.collection("companies").doc(c.id));
    const docs = await tx.getAll(...refs);
    docs.forEach((doc, i) => {
      const old = doc.data(), proposal = batch.companies[i];
      assert(old && old.name === proposal.expectedName, `${proposal.id}: missing company or identity changed`);
      assert(["PUBLISHED", "DIRECTORY"].includes(old.status), `${proposal.id}: company is not public`);
      assert(!old.profile?.checkedAt || old.profile.checkedAt <= batch.asOf, `${proposal.id}: newer profile already exists`);
      assert(!old.profile?.financialReport || proposal.profile.financialReport, `${proposal.id}: refusing to remove an existing report`);
      assert(!old.profile?.financialReport?.periodEnd || !proposal.profile.financialReport || old.profile.financialReport.periodEnd <= proposal.profile.financialReport.periodEnd, `${proposal.id}: refusing older financial report`);
    });
    if (write) batch.companies.forEach((c, i) => tx.update(refs[i], { profile: { ...docs[i].data()?.profile, ...normalizeCompanyProfile(c.profile) } }));
    return { write, companies: refs.length, reports: batch.companies.filter(c => c.profile.financialReport).length, collection: "companies" };
  }, write ? { readOnly: false } : { readOnly: true });
}
async function main() {
  const batch = JSON.parse(await readFile(new URL("../data/ai-supply-chain/company-profiles.json", import.meta.url), "utf8"));
  validateProfiles(batch);
  if (process.argv.includes("--validate")) { console.log(`Validated ${batch.companies.length} company profiles`); return; }
  assert(process.env.GCP_PROJECT_ID && (process.argv.includes("--preview") || process.argv.includes("--write")), "Use --validate, --preview or --write with GCP_PROJECT_ID");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  console.log(JSON.stringify(await publishProfiles(getFirestore(), batch, process.argv.includes("--write"))));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error ? error.message : "Profile publication failed"); process.exitCode = 1; });
