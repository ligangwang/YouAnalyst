import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, type Firestore, type Transaction } from "firebase-admin/firestore";
import { applyResearchPlan, planResearchInTransaction, validateResearch, type ResearchBatch } from "./publish-global-ai-research";
import { applyBatchPlan, hash, planBatchInTransaction, validateBatch, type ComputeBatch, type Plan } from "../src/lib/research/publisher";
import { relationshipTrust } from "../src/lib/knowledge-graph/relationship-status";
import type { GraphFact } from "../src/lib/knowledge-graph/model";

// Reviewed relationship verification: new company identities first (existing `companies` collection),
// then relationship facts (existing `company_relationships` collection). No other collection is touched.
// `summary` paraphrases the cited passage; it is not a verbatim quote and is stored as an editorial summary.
type Source = ComputeBatch["sources"][number] & { publisher: string; summary: string };
export type VerificationBatch = Omit<ComputeBatch, "sources"> & { rule: Record<string, string>; companies: ResearchBatch["companies"]; sources: Source[] };
export type Preview = { batchHash: string; identities: [string, string][]; companyPlanHash: string; plan: Plan; summary: ChangeSummary[] };
export type ChangeSummary = { id: string; action: "ADD" | "UPDATE" | "UNCHANGED"; trustBefore: string; trustAfter: string; commercialStatus: string; factsVerified: string[]; factsAdded: string[]; sources: string[] };
const FILE = new URL("../data/ai-supply-chain/relationship-verification.json", import.meta.url);
const PREVIEW = "relationship-verification-preview.json";
const validId = (id: string) => /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(id);

export function companyBatch(b: VerificationBatch): ResearchBatch {
  return { asOf: b.asOf, companies: b.companies, relationships: [], sources: b.sources.map(s => ({ id: s.id, url: s.url, title: s.title, sourceDate: s.sourceDate, retrievedAt: s.retrievedAt, excerpt: s.summary, excerptKind: "EDITORIAL_SUMMARY" as const })) };
}
export function relationshipBatch(b: VerificationBatch, identities: Map<string, string> = new Map()): ComputeBatch {
  const resolve = (id: string) => identities.get(id) ?? id;
  return { batchId: b.batchId, asOf: b.asOf, sources: b.sources.map(s => ({ id: s.id, url: s.url, title: s.title, sourceDate: s.sourceDate, retrievedAt: s.retrievedAt })),
    relationships: b.relationships.map(e => ({ ...e, source: resolve(e.source), target: resolve(e.target) })) };
}
/** Enforces the verification rule: a CONFIRMED fact is documented and published by one of its two companies. */
export function validateVerification(b: VerificationBatch) {
  validateResearch(companyBatch(b));
  validateBatch(relationshipBatch(b));
  assert(b.rule?.verified?.trim(), "Batch must state its verification rule");
  const sources = new Map(b.sources.map(s => [s.id, s]));
  for (const s of b.sources) assert(validId(s.publisher) && s.summary.trim(), `Source ${s.id} needs a publisher company and summary`);
  for (const e of b.relationships) for (const f of e.facts) {
    if (f.verificationStatus !== "CONFIRMED") continue;
    assert(f.state === "DOCUMENTED", `${e.source} ${e.type} ${e.target}: announced or planned facts cannot be verified`);
    assert(f.sourceIds.some(id => [e.source, e.target].includes(sources.get(id)!.publisher)), `${e.source} ${e.type} ${e.target}: verification needs a source published by one of the two companies`);
  }
}

export type LinkResult = { id: string; url: string; status: number | null; outcome: "OK" | "BLOCKED" | "DEAD" | "ERROR"; detail?: string };
/** DEAD/ERROR block publication; BLOCKED (bot protection such as 401/403/429) must be opened manually by the reviewer. */
export async function checkLinks(b: VerificationBatch, fetcher: typeof fetch = fetch): Promise<LinkResult[]> {
  const agent = process.env.SOURCE_CHECK_USER_AGENT || "YouAnalyst source-link check (+https://youanalyst.com)";
  return Promise.all([...new Map(b.sources.map(s => [s.url, s])).values()].map(async s => {
    try {
      const r = await fetcher(s.url, { redirect: "follow", headers: { "user-agent": agent, accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(30_000) });
      await r.body?.cancel();
      const outcome = r.ok ? "OK" : [404, 410].includes(r.status) ? "DEAD" : [401, 403, 405, 429, 999].includes(r.status) ? "BLOCKED" : "ERROR";
      return { id: s.id, url: s.url, status: r.status, outcome };
    } catch (error) {
      return { id: s.id, url: s.url, status: null, outcome: "ERROR", detail: error instanceof Error ? error.message : String(error) };
    }
  }));
}

function trust(row: Record<string, unknown> | null) {
  return row ? relationshipTrust({ facts: (row.researchFacts ?? []) as GraphFact[] }).status : "NONE";
}
export function summarize(plan: Plan): ChangeSummary[] {
  return plan.changes.map(c => {
    const before = (c.before?.researchFacts ?? []) as (GraphFact & { id: string })[];
    const after = (c.after.researchFacts ?? []) as (GraphFact & { id: string })[];
    const known = new Map(before.map(f => [f.id, f]));
    const oldUrls = new Set(((c.before?.evidence ?? []) as { url: string }[]).map(s => s.url));
    return { id: c.id, action: !c.before ? "ADD" : c.changed ? "UPDATE" : "UNCHANGED", trustBefore: trust(c.before), trustAfter: trust(c.after),
      commercialStatus: `${c.before?.commercialStatus ?? "—"} → ${c.after.commercialStatus}`,
      factsVerified: after.filter(f => known.has(f.id) && known.get(f.id)!.verificationStatus !== f.verificationStatus).map(f => `${f.state} ${f.verificationStatus}: ${f.scope}`),
      factsAdded: after.filter(f => !known.has(f.id)).map(f => `${f.state}${f.verificationStatus ? ` ${f.verificationStatus}` : ""}: ${f.scope}`),
      sources: ((c.after.evidence ?? []) as { url: string }[]).filter(s => !oldUrls.has(s.url)).map(s => s.url) };
  });
}
export function summaryMarkdown(summary: ChangeSummary[], identities: [string, string][]) {
  const count = (a: ChangeSummary["action"]) => summary.filter(s => s.action === a).length;
  return [`# Relationship verification dry run`, ``, `Relationships: ${count("ADD")} added, ${count("UPDATE")} updated, ${count("UNCHANGED")} unchanged. Company identities: ${identities.map(([p, r]) => p === r ? p : `${p} → existing ${r}`).join(", ")}.`, ``,
    `| Relationship | Action | Display before → after | Commercial status | Changes |`, `|---|---|---|---|---|`,
    ...summary.map(s => `| ${s.id} | ${s.action} | ${s.trustBefore} → ${s.trustAfter} | ${s.commercialStatus} | ${[...s.factsVerified.map(f => `marked ${f}`), ...s.factsAdded.map(f => `added ${f}`), ...s.sources.map(u => `source ${u}`)].join("<br>").replaceAll("|", "\\|") || "—"} |`)].join("\n");
}

type Planned = Omit<Preview, "summary">;
/** Reads everything and plans companies and relationships in one transaction; with `approved`, refuses any mismatch. Never writes. */
async function planAll(db: Firestore, tx: Transaction, b: VerificationBatch, approved?: Preview) {
  const research = await planResearchInTransaction(db, tx, companyBatch(b));
  const identities = research.companies, map = new Map(identities);
  const companyPlanHash = hash(research.ops.map(([ref, value]) => [ref.path, value]));
  if (approved) {
    assert.deepEqual(identities, approved.identities, "Company identity resolution changed since the dry run");
    assert.equal(companyPlanHash, approved.companyPlanHash, "Company records changed since the dry run");
  }
  // Companies created in this same transaction count as existing relationship endpoints.
  const plan = await planBatchInTransaction(db, tx, relationshipBatch(b, map), approved?.plan, new Set(map.values()));
  return { research, planned: { batchHash: hash(b), identities, companyPlanHash, plan } satisfies Planned };
}
/**
 * Read-only unless `approved` is supplied. A write re-plans the complete batch and commits company identities and
 * relationships in a single transaction, so a stale or mismatched preview fails with nothing written.
 */
export async function run(db: Firestore, b: VerificationBatch, approved?: Preview): Promise<Preview> {
  validateVerification(b);
  if (approved) assert.equal(approved.batchHash, hash(b), "Preview is for a different batch; run the dry run again");
  const planned = await db.runTransaction(async tx => {
    const { research, planned } = await planAll(db, tx, b, approved);
    if (approved) { applyResearchPlan(tx, research); applyBatchPlan(db, tx, planned.plan); }
    return planned;
  }, approved ? { readOnly: false } : { readOnly: true });
  if (approved) {
    const verify = await db.runTransaction(async tx => (await planAll(db, tx, b)).planned.plan, { readOnly: true });
    assert(verify.changes.every(c => !c.changed), "Publication incomplete or not idempotent");
  }
  return { ...planned, summary: summarize(planned.plan) };
}

async function main() {
  const b = JSON.parse(await readFile(FILE, "utf8")) as VerificationBatch;
  validateVerification(b);
  const flag = (name: string) => process.argv.includes(name);
  if (flag("--validate")) {
    const confirmed = b.relationships.filter(e => e.facts.some(f => f.verificationStatus === "CONFIRMED")).length;
    console.log(`Valid: ${b.companies.length} company identities, ${b.relationships.length} relationships (${confirmed} with verified facts), ${b.sources.length} sources`);
    return;
  }
  if (flag("--check-links")) {
    const results = await checkLinks(b);
    for (const r of results) console.log(`${r.outcome.padEnd(7)} ${String(r.status ?? "-").padEnd(4)} ${r.id} ${r.url}${r.detail ? ` (${r.detail})` : ""}`);
    const failed = results.filter(r => r.outcome === "DEAD" || r.outcome === "ERROR");
    console.log(`${results.length - failed.length}/${results.length} reachable; ${results.filter(r => r.outcome === "BLOCKED").length} blocked automated access and need a manual check`);
    if (failed.length) process.exitCode = 1;
    return;
  }
  assert(process.env.GCP_PROJECT_ID && (flag("--dry-run") || flag("--write")), "Use --validate, --check-links, --dry-run or --write (the last two need GCP_PROJECT_ID)");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const approved = flag("--write") ? JSON.parse(await readFile(PREVIEW, "utf8")) as Preview : undefined;
  const result = await run(getFirestore(), b, approved);
  const markdown = summaryMarkdown(result.summary, result.identities);
  await writeFile(approved ? "relationship-verification-written.json" : PREVIEW, JSON.stringify(result, null, 2));
  await writeFile(approved ? "relationship-verification-written.md" : "relationship-verification-summary.md", markdown);
  console.log(markdown);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e instanceof Error ? e.message : "Relationship verification failed"); process.exitCode = 1; });
