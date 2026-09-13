import { readFile, mkdir, writeFile } from "node:fs/promises";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { matchCompany, type CompanyIdentity } from "../src/lib/market-companies/identity";

// Read-only: produces an identity review artifact. Publication is a separate action.
async function main() {
  const file = process.argv[2];
  if (!file || !process.env.GCP_PROJECT_ID) throw new Error("Provide a proposal JSON path and GCP_PROJECT_ID");
  const input: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(input) || !input.length || input.length > 500 || input.some(c => !c || typeof c.id !== "string" || typeof c.name !== "string" || !c.name.trim())) throw new Error("Expected 1–500 company identity proposals");
  const proposals = input as CompanyIdentity[];
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const snapshot = await getFirestore().collection("companies").select("name", "legalName", "aliases", "website", "country", "identifiers", "listings", "symbol", "micCode", "cik").get();
  const existing = snapshot.docs.map(d => {
    const data = d.data();
    const identifiers = Array.isArray(data.identifiers) ? data.identifiers : [];
    if (data.cik) identifiers.push({ scheme: "CIK", value: String(data.cik) });
    const listings = Array.isArray(data.listings) ? data.listings : [];
    if (data.symbol && data.micCode) listings.push({ exchange: data.micCode, symbol: data.symbol, market: "" });
    return { ...data, id: d.id, name: String(data.name ?? ""), identifiers, listings } as CompanyIdentity;
  });
  const results = proposals.map(p => ({ proposal: p, match: matchCompany(p, existing), batchMatch: matchCompany(p, proposals.filter(other => other !== p)) }));
  const report = { generatedAt: new Date().toISOString(), companyCount: existing.length, results };
  await mkdir("output/company-identity-review", { recursive: true });
  await writeFile("output/company-identity-review/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checked: existing.length, proposals: results.length, existing: results.filter(r => r.match.status === "EXISTING").length, new: results.filter(r => r.match.status === "NEW").length, review: results.filter(r => r.match.status === "REVIEW" || r.batchMatch.status !== "NEW").length }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Identity review failed"); process.exitCode = 1; });
