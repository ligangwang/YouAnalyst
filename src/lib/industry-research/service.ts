import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase/admin";
import { safeRecordOpenAiUsageEvent } from "../openai/usage";
import { normalizeResearch, record, text, RESEARCH_VERSION, type ResearchResult, type ResearchRelationship } from "./model";
import { openAiResearch, readResearchResponse, researchRequest } from "./openai";

export function createIndustryResearchService(getDb: () => Firestore, provider = openAiResearch, recordUsage = safeRecordOpenAiUsageEvent) {
const runs = () => getDb().collection("industry_research_runs");
async function startResearch(industry: string, requestId: string, uid: string) {
  if (industry.length < 3 || industry.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9 &,()./-]+$/.test(industry)) throw new Error("Enter an industry name (3-120 characters).");
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new Error("Invalid request ID.");
  const db = getDb(), ref = runs().doc(requestId);
  const industryKey = createHash("sha256").update(industry.toLowerCase().replace(/\s+/g, " ")).digest("hex");
  const lock = db.collection("industry_research_locks").doc(industryKey);
  const budget = db.collection("industry_research_limits").doc(new Date().toISOString().slice(0, 10));
  const now = new Date().toISOString();
  const created = await db.runTransaction(async tx => {
    const prior = await tx.get(ref);
    if (prior.exists) return false;
    const locked = await tx.get(lock), limit = await tx.get(budget);
    if (locked.data()?.active === true) throw new Error("This industry already has a research run. Refresh its status first.");
    if ((limit.data()?.count ?? 0) >= 3) throw new Error("Daily research limit reached (3 batches). Try again tomorrow.");
    tx.set(ref, { id: requestId, industry, industryKey, version: RESEARCH_VERSION, status: "STARTING", createdAt: now, createdBy: uid });
    tx.set(lock, { active: true, runId: requestId });
    tx.set(budget, { count: FieldValue.increment(1) }, { merge: true });
    return true;
  });
  if (!created) return (await ref.get()).data();
  try {
    const existing = await db.collection("industry_research_relationships").where("status", "==", "PUBLISHED").limit(160).get();
    const response = await provider("", researchRequest(industry, existing.docs.map(d => d.id)));
    if (!/^resp_[a-zA-Z0-9_-]+$/.test(text(response.id))) throw new Error("OpenAI did not return a response ID.");
    await ref.update({ status: "PROCESSING", responseId: response.id, model: text(response.model) || "gpt-5.4", updatedAt: now });
  } catch (error) {
    // An uncertain provider response must not be retried automatically or incur duplicate spend.
    const providerError = error instanceof Error && error.message.startsWith("OpenAI research request failed (") ? `${error.message} ` : "";
    await ref.update({ status: "FAILED", error: `${providerError}Research could not be started. Check provider usage before starting another batch.`, updatedAt: new Date().toISOString() });
    await lock.set({ active: false }, { merge: true });
  }
  return (await ref.get()).data();
}

async function refreshResearch(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid run ID.");
  const db = getDb(), ref = runs().doc(id), snapshot = await ref.get();
  const run = snapshot.data();
  if (!run) throw new Error("Research run not found.");
  if (run.status !== "PROCESSING") return run;
  if (!/^resp_[a-zA-Z0-9_-]+$/.test(text(run.responseId))) throw new Error("Invalid stored response ID.");
  const response = await provider(`/${run.responseId}`);
  if (["queued", "in_progress"].includes(text(response.status))) return run;
  const now = new Date().toISOString();
  let result: ResearchResult | null = null, searchCalls = 0;
  let error = "Research did not complete. Existing published connections were preserved.";
  if (response.status === "completed") {
    try {
      const parsed = readResearchResponse(response);
      searchCalls = parsed.searchCalls;
      result = normalizeResearch(parsed.data, parsed.sources);
      if (!result.relationships.length) { result = null; error = "No sourced relationships passed validation. Existing connections were preserved."; }
    } catch { error = "Research returned invalid structured output. Existing connections were preserved."; }
  }
  const saved = await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.data()?.status !== "PROCESSING") return false;
    tx.update(ref, { status: result ? "DRAFT" : "FAILED", result, error: result ? null : error, updatedAt: now,
      usage: record(response.usage), searchCalls, model: text(response.model) || run.model });
    tx.set(db.collection("industry_research_locks").doc(run.industryKey), { active: false }, { merge: true });
    return true;
  });
  if (saved) await recordUsage({ purpose: "industry_research", model: text(response.model) || run.model,
    responseId: run.responseId, usage: record(response.usage), createdAt: now,
    metadata: { runId: id, industry: run.industry, searchCalls, toolFeesExcluded: true } });
  return (await ref.get()).data();
}

async function publishResearch(id: string, selectedIds: string[], uid: string) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !selectedIds.length || selectedIds.length > 80 || selectedIds.some(x => typeof x !== "string")) throw new Error("Select 1-80 reviewed connections.");
  const db = getDb(), ref = runs().doc(id);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), run = snapshot.data();
    if (!run || !["DRAFT", "PUBLISHED"].includes(run.status) || run.version !== RESEARCH_VERSION) throw new Error("A completed draft is required.");
    const result = run.result as ResearchResult;
    const selected = result.relationships.filter(r => selectedIds.includes(r.id));
    if (selected.length !== new Set(selectedIds).size) throw new Error("Unknown relationship selected.");
    const symbols = new Set(selected.flatMap(r => [r.source, r.target]));
    const companies = result.companies.filter(c => symbols.has(c.ticker));
    // Validate against our current securities directory before linking public ticker pages.
    for (const c of companies) {
      const listing = await tx.get(db.collection("tickers").where("symbol", "==", c.ticker).limit(20));
      if (!listing.docs.some(d => d.data().active === true && d.data().predictionSupported === true)) throw new Error(`${c.ticker} has no supported active listing. Leave its connections unselected.`);
    }
    const refs = selected.map(r => db.collection("industry_research_relationships").doc(r.id));
    const existing = await tx.getAll(...refs);
    const companyRefs = companies.map(c => db.collection("industry_research_companies").doc(c.ticker));
    const companyDocs = await tx.getAll(...companyRefs);
    const now = new Date().toISOString();
    companies.forEach((c, i) => {
      if (!companyDocs[i].exists) tx.set(companyRefs[i], { ...c, createdAt: now, reviewedBy: uid });
    });
    selected.forEach((r, i) => {
      const prior = existing[i].data();
      const evidence = [...(Array.isArray(prior?.evidence) ? prior.evidence : []), ...r.evidence];
      tx.set(refs[i], { ...r, evidence: evidence.filter((e, n) => evidence.findIndex(x => x.url === e.url) === n).slice(-10),
        status: "PUBLISHED", updatedAt: now, reviewedBy: uid, industries: FieldValue.arrayUnion(run.industryKey), runIds: FieldValue.arrayUnion(id) }, { merge: true });
    });
    tx.update(ref, { status: "PUBLISHED", publishedAt: now, publishedBy: uid, publishedIds: FieldValue.arrayUnion(...selectedIds) });
  });
  return (await ref.get()).data();
}

async function listResearch() {
  return (await runs().orderBy("createdAt", "desc").limit(10).get()).docs.map(d => d.data());
}
return { startResearch, refreshResearch, publishResearch, listResearch };
}
export const { startResearch, refreshResearch, publishResearch, listResearch } = createIndustryResearchService(getAdminFirestore);
export type PublishedResearchRelationship = ResearchRelationship & { status: "PUBLISHED" };
