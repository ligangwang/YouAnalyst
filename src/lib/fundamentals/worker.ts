import { getAdminFirestore } from "../firebase/admin";
import { fetchLatest10KSections } from "../company-graph/sec";
import { annualMetrics, businessExcerpt, latestAnnualReport, type CompanyFacts, type CompanyFundamentals } from "./model";
import { FUNDAMENTALS_COLLECTION, validFundamentalsTicker, needsShareMetadataUpgrade } from "./service";
import { maintenanceError, type MaintenanceLog } from "../maintenance-log";
import { secRequest } from "../sec-request";
import { assessShares } from "./market-cap";
import type { SecFilingDiscovered } from "../sec-filings/event";

const DAY = 86_400_000;
class SecFilingPendingError extends Error {
  constructor(message: string, readonly code = "SEC_FILING_SUBMISSIONS_UNRESOLVED") { super(message); }
}
let identities: { expires: number; value: Promise<Map<string, string>> } | null = null;
async function secJson<T>(url: string): Promise<T> {
  return secRequest(url, {
    headers: { "user-agent": process.env.SEC_USER_AGENT?.trim() || "YouAnalyst/1.0 (https://youanalyst.com)", accept: "application/json" },
    cache: "no-store", signal: AbortSignal.timeout(12_000),
  }, response => response.json() as Promise<T>, { operation: "fundamentals_json" });
}

async function resolveCik(ticker: string): Promise<string | null> {
  if (!identities || identities.expires < Date.now()) {
    identities = { expires: Date.now() + DAY, value: secJson<{ fields: string[]; data: unknown[][] }>("https://www.sec.gov/files/company_tickers_exchange.json").then(payload => {
      const cikIndex = payload.fields.indexOf("cik"), tickerIndex = payload.fields.indexOf("ticker");
      if (cikIndex < 0 || tickerIndex < 0) throw new Error("SEC identity columns missing");
      return new Map(payload.data.flatMap(row => {
        const cik = String(row[cikIndex]), symbol = row[tickerIndex];
        return typeof symbol === "string" && /^\d{1,10}$/.test(cik) ? [[symbol.toUpperCase(), cik.padStart(10, "0")]] : [];
      }));
    }).catch(error => { identities = null; throw error; }) };
  }
  const mapping = await identities.value;
  // SEC uses hyphens for share classes; only use the alias when there is no exact mapping.
  return mapping.get(ticker) ?? mapping.get(ticker.replaceAll(".", "-")) ?? null;
}

export async function refreshCompanyFundamentals(ticker: string, dependencies?: {
  db: ReturnType<typeof getAdminFirestore>; identify?: typeof resolveCik; readJson?: typeof secJson; readSections?: typeof fetchLatest10KSections; log?: MaintenanceLog;
  filing?: SecFilingDiscovered;
}): Promise<CompanyFundamentals | null> {
  if (!validFundamentalsTicker(ticker)) throw new Error("Invalid fundamentals ticker");
  if (dependencies?.filing && dependencies.filing.companyId !== ticker) throw new Error("Filing request must target its issuer");
  const db = dependencies?.db ?? getAdminFirestore();
  const identify = dependencies?.identify ?? resolveCik;
  const readJson = dependencies?.readJson ?? secJson;
  const ref = db.collection(FUNDAMENTALS_COLLECTION).doc(ticker);
  const now = Date.now();
  const lease = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const stored = snapshot.data();
    const value = stored?.version === 1 ? (stored.value as CompanyFundamentals | null) ?? null : null;
    const needsShareUpgrade = needsShareMetadataUpgrade(stored);
    const filingRefresh = dependencies?.filing && stored?.lastFilingRefresh?.eventId !== dependencies.filing.eventId;
    const coolingDown = stored?.pending === true && stored.outcome === "retry" && Number(stored.refreshAfter) > now;
    if (coolingDown || (stored?.version === 1 && Number(stored.refreshAfter) > now && !needsShareUpgrade && !filingRefresh)) return { acquired: false, value };
    tx.set(ref, { version: 1, pending: true, refreshAfter: now + 90_000, lastAttemptAt: new Date(now).toISOString() }, { merge: true });
    return { acquired: true, value };
  });
  if (!lease.acquired) return lease.value;
  try {
    const cik = await identify(ticker);
    if (dependencies?.filing && (!cik || cik !== dependencies.filing.cik)) throw new Error("Filing issuer does not match SEC ticker mapping");
    if (!cik) {
      await ref.set({ version: 1, value: lease.value, pending: false, outcome: "unavailable", unavailableReason: "No SEC ticker mapping", refreshAfter: now + 7 * DAY, lastError: null }, { merge: true });
      return null;
    }
    const submissions = await readJson<Parameters<typeof latestAnnualReport>[1] & { tickers?: string[] }>(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const report = latestAnnualReport(cik, submissions);
    if (dependencies?.filing && ["10-K", "20-F", "40-F"].includes(dependencies.filing.form) && !report) {
      throw new SecFilingPendingError("SEC submissions have not incorporated an annual report yet");
    }
    if (!report) {
      await ref.set({ version: 1, value: lease.value, pending: false, outcome: "unavailable", unavailableReason: "No annual SEC report", refreshAfter: now + 7 * DAY, lastError: null }, { merge: true });
      return null;
    }
    const facts = await readJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    if (Number(facts.cik) !== Number(cik)) throw new Error("SEC company identity mismatch");
    const filingFactsPresent = dependencies?.filing && Object.values(facts.facts ?? {}).some(taxonomy =>
      Object.values(taxonomy).some(concept => Object.values(concept.units ?? {}).some(rows =>
        Array.isArray(rows) && rows.some(row => row.accn === dependencies.filing!.accessionNumber))));
    if (dependencies?.filing?.isXbrl && !filingFactsPresent) {
      throw new SecFilingPendingError("SEC company facts do not contain this filing accession; source lag or unavailable API facts require retry/review",
        "SEC_FILING_FACTS_UNRESOLVED");
    }
    const recentAccessions = submissions.filings?.recent?.accessionNumber;
    if (dependencies?.filing && ["10-K", "20-F", "40-F"].includes(dependencies.filing.form)
      && !filingFactsPresent && !(Array.isArray(recentAccessions) && recentAccessions.includes(dependencies.filing.accessionNumber))
      && report.filed < dependencies.filing.filingDate) {
      throw new SecFilingPendingError("SEC submissions have not incorporated the filing yet");
    }
    let excerpt: string | null = null;
    if (report.form === "10-K") {
      try {
        const section = await db.collection("sec_filing_sections").doc(`${report.accession}_item1`).get();
        if (typeof section.get("text") === "string") excerpt = businessExcerpt(section.get("text"));
        if (!excerpt) {
          const sections = await (dependencies?.readSections ?? fetchLatest10KSections)(cik, { accessionNumber: report.accession, filingDate: report.filed, reportDate: report.end, primaryDocument: report.url.split("/").pop()!, filingUrl: report.url }, AbortSignal.timeout(12_000));
          excerpt = businessExcerpt(sections.find(item => item.id === "item1")?.text ?? "");
        }
      } catch (error) {
        const code = maintenanceError(error).code;
        if (code === 403 || code === 429) throw error;
        dependencies?.log?.emit("WARNING", "excerpt_unavailable", { ticker, error: maintenanceError(error) });
        excerpt = lease.value?.report.accession === report.accession ? lease.value.excerpt : null;
      }
    }
    const value: CompanyFundamentals = { report, metrics: annualMetrics(facts, report), excerpt, fetchedAt: new Date().toISOString(),
      shareAssessment: assessShares(facts, ticker, submissions.tickers, report.form) };
    // Freshness margin prevents daily runs skipping yesterday's cache if today's
    // worker starts a few seconds earlier.
    await ref.set({ version: 1, value, pending: false, outcome: "ready", unavailableReason: null, lastError: null,
      ...(dependencies?.filing ? { lastFilingRefresh: { eventId: dependencies.filing.eventId,
        accessionNumber: dependencies.filing.accessionNumber, filingDate: dependencies.filing.filingDate } } : {}),
      refreshAfter: Date.now() + 23 * 3_600_000 }, { merge: true });
    return value;
  } catch (error) {
    // Preserve the last good cache and request for the next scheduled run.
    const details = maintenanceError(error);
    await ref.set({ version: 1, pending: true, outcome: "retry", lastError: { ...details, stack: details.stack ?? null },
      refreshAfter: Date.now() + (error instanceof SecFilingPendingError ? 300_000 : 3_600_000) }, { merge: true })
      .catch(persistError => dependencies?.log?.emit("ERROR", "failure_status_write_failed", { ticker, error: maintenanceError(persistError) }));
    throw error;
  }
}
