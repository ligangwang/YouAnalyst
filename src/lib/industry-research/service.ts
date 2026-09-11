import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase/admin";
import { safeRecordOpenAiUsageEvent } from "../openai/usage";
import { normalizeResearch, record, text, RESEARCH_VERSION, type ResearchResult, type ResearchRelationship } from "./model";
import { openAiResearch, readResearchResponse, researchRequest } from "./openai";
import { resolveResearchTopic, researchTopicLabel } from "./taxonomy";
import { MARKET_COMPANIES, normalizeChinaCompany, normalizeChinaResearch, chinaResearchDiagnostics } from "./china";

export function createIndustryResearchService(getDb: () => Firestore, provider = openAiResearch, recordUsage = safeRecordOpenAiUsageEvent) {
const runs = () => getDb().collection("industry_research_runs");
async function startResearch(scope: string, requestId: string, uid: string, category?: unknown, market: "US" | "CN_A" = "US") {
  if (!["US", "CN_A"].includes(market)) throw new Error("Invalid research market.");
  const topic = resolveResearchTopic(scope, category);
  const industry = researchTopicLabel(topic);
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new Error("Invalid request ID.");
  const db = getDb(), ref = runs().doc(requestId);
  const industryKey = createHash("sha256").update((market === "CN_A" ? "CN_A:" : "") + industry.toLowerCase().replace(/\s+/g, " ")).digest("hex");
  const lock = db.collection("industry_research_locks").doc(industryKey);
  const budget = db.collection("industry_research_limits").doc(new Date().toISOString().slice(0, 10));
  const now = new Date().toISOString();
  const created = await db.runTransaction(async tx => {
    const prior = await tx.get(ref);
    if (prior.exists) {
      if (prior.data()?.industryKey !== industryKey) throw new Error("This request ID belongs to another topic. Refresh runs before starting a different topic.");
      return false;
    }
    const locked = await tx.get(lock), limit = await tx.get(budget);
    if (locked.data()?.active === true) throw new Error("This industry already has a research run. Refresh its status first.");
    if ((limit.data()?.count ?? 0) >= 3) throw new Error("Daily research limit reached (3 batches). Try again tomorrow.");
    tx.set(ref, { id: requestId, industry, topic, market, industryKey, version: RESEARCH_VERSION, status: "STARTING", createdAt: now, createdBy: uid });
    tx.set(lock, { active: true, runId: requestId });
    tx.set(budget, { count: FieldValue.increment(1) }, { merge: true });
    return true;
  });
  if (!created) return (await ref.get()).data();
  try {
    const existing = await db.collection(market === "CN_A" ? MARKET_COMPANIES : "industry_research_relationships").where("status", "==", "PUBLISHED").limit(160).get();
    const response = await provider("", researchRequest(industry, existing.docs.map(d => d.id), topic, market));
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
  if (run.status !== "PROCESSING" || !run.responseId) return run;
  if (!/^resp_[a-zA-Z0-9_-]+$/.test(text(run.responseId))) throw new Error("Invalid stored response ID.");
  const response = await provider(`/${run.responseId}`);
  if (["queued", "in_progress"].includes(text(response.status))) return run;
  const now = new Date().toISOString();
  let result: ResearchResult | null = null;
  const searchCalls = (Array.isArray(response.output) ? response.output : []).filter(item => record(item).type === "web_search_call").length;
  const reason = text(record(response.incomplete_details).reason) || text(record(response.error).code) || text(response.status);
  let error = `Research did not complete (${reason.slice(0, 100)}). Existing published connections were preserved.`;
  if (response.status === "completed") {
    try {
      const parsed = readResearchResponse(response);
      result = run.market === "CN_A" ? normalizeChinaResearch(parsed.data, parsed.sources) : normalizeResearch(parsed.data, parsed.sources);
      if (!(run.market === "CN_A" ? result.chinaCompanies?.length : result.relationships.length)) { result = null; error = "No sourced candidates passed validation. Existing published data was preserved."; }
    } catch { error = "Research returned invalid structured output. Existing connections were preserved."; }
  }
  const saved = await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.data()?.status !== "PROCESSING") return false;
    const lockRef = db.collection("industry_research_locks").doc(run.industryKey);
    const lock = await tx.get(lockRef);
    tx.update(ref, { status: result ? "DRAFT" : "FAILED", result, error: result ? null : error, updatedAt: now,
      usage: record(response.usage), searchCalls, providerStatus: text(response.status), incompleteReason: reason, model: text(response.model) || run.model });
    if (lock.data()?.runId === id) tx.set(lockRef, { active: false }, { merge: true });
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
    if (run.market === "CN_A") {
      const selected = (result.chinaCompanies ?? []).filter(c => selectedIds.includes(c.id));
      if (selected.length !== new Set(selectedIds).size || selected.some(c => !normalizeChinaCompany(c))) throw new Error("Unknown or invalid company selected.");
      const refs = selected.map(c => db.collection(MARKET_COMPANIES).doc(c.id));
      const existing = await tx.getAll(...refs);
      const now = new Date().toISOString();
      selected.forEach((company, i) => {
        // Existing editorial profiles and newer reports are never replaced by discovery.
        tx.set(refs[i], {
          ...(!existing[i].exists ? { ...company, market: "CN_A", status: "PUBLISHED", createdAt: now, reviewedAt: now, reviewedBy: uid } : {}),
          researchTopics: FieldValue.arrayUnion(run.industry), runIds: FieldValue.arrayUnion(id),
          ...(run.topic?.industryCode ? { researchIndustryCodes: FieldValue.arrayUnion(run.topic.industryCode), researchSectorCodes: FieldValue.arrayUnion(run.topic.sectorCode) } : {}),
        }, { merge: true });
      });
      tx.update(ref, { status: "PUBLISHED", publishedAt: now, publishedBy: uid, publishedIds: FieldValue.arrayUnion(...selectedIds) });
      return;
    }
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
        status: "PUBLISHED", updatedAt: now, reviewedBy: uid, industries: FieldValue.arrayUnion(run.industryKey), runIds: FieldValue.arrayUnion(id),
        ...(run.topic?.industryCode ? { researchIndustryCodes: FieldValue.arrayUnion(run.topic.industryCode), researchSectorCodes: FieldValue.arrayUnion(run.topic.sectorCode) } : {}) }, { merge: true });
    });
    tx.update(ref, { status: "PUBLISHED", publishedAt: now, publishedBy: uid, publishedIds: FieldValue.arrayUnion(...selectedIds) });
  });
  return (await ref.get()).data();
}

async function listResearch() {
  return (await runs().orderBy("createdAt", "desc").limit(10).get()).docs.map(d => d.data());
}
async function diagnoseResearch(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid run ID.");
  const ref = runs().doc(id), run = (await ref.get()).data();
  if (!run || run.market !== "CN_A" || !/^resp_[a-zA-Z0-9_-]+$/.test(text(run.responseId))) throw new Error("An A-share research response is required.");
  // Retrieve the existing response only; never submit a new paid generation.
  const response = await provider(`/${run.responseId}`);
  let diagnostics;
  try {
    const parsed = readResearchResponse(response);
    diagnostics = { ...chinaResearchDiagnostics(parsed.data, parsed.sources), providerStatus: text(response.status), incompleteReason: text(record(response.incomplete_details).reason) };
  } catch {
    diagnostics = { providerStatus: text(response.status), incompleteReason: text(record(response.incomplete_details).reason), parseError: "The saved response contains no complete company JSON." };
  }
  await ref.update({ diagnostics });
  return (await ref.get()).data();
}
return { startResearch, refreshResearch, publishResearch, listResearch, diagnoseResearch };
}
export const { startResearch, refreshResearch, publishResearch, listResearch, diagnoseResearch } = createIndustryResearchService(getAdminFirestore);
export type PublishedResearchRelationship = ResearchRelationship & { status: "PUBLISHED" };
