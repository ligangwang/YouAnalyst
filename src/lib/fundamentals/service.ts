import { getAdminFirestore } from "../firebase/admin";
import { fetchLatest10KSections } from "../company-graph/sec";
import { annualMetrics, businessExcerpt, latestAnnualReport, type CompanyFacts, type CompanyFundamentals } from "./model";

const DAY = 86_400_000;
const pending = new Map<string, Promise<CompanyFundamentals | null>>();
let identities: { expires: number; value: Promise<Map<string, string>> } | null = null;
let requestQueue = Promise.resolve();

// Four starts per second in this process. Cached summaries and per-company leases limit repeat reads.
async function secJson<T>(url: string): Promise<T> {
  const turn = requestQueue.then(() => new Promise<void>(resolve => setTimeout(resolve, 250)));
  requestQueue = turn.catch(() => undefined);
  await turn;
  const response = await fetch(url, {
    headers: { "user-agent": process.env.SEC_USER_AGENT?.trim() || "YouAnalyst/1.0 (https://youanalyst.com)", accept: "application/json" },
    cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`SEC status ${response.status}`);
  return response.json() as Promise<T>;
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
  db: ReturnType<typeof getAdminFirestore>; identify: typeof resolveCik; readJson: typeof secJson;
}): Promise<CompanyFundamentals | null> {
  const db = dependencies?.db ?? getAdminFirestore();
  const identify = dependencies?.identify ?? resolveCik;
  const readJson = dependencies?.readJson ?? secJson;
  const ref = db.collection("company_fundamentals").doc(ticker);
  const now = Date.now();
  const lease = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const stored = snapshot.data();
    const value = stored?.version === 1 ? (stored.value as CompanyFundamentals | null) ?? null : null;
    if (stored?.version === 1 && Number(stored.refreshAfter) > now) return { acquired: false, value };
    tx.set(ref, { version: 1, refreshAfter: now + 90_000 }, { merge: true });
    return { acquired: true, value };
  });
  if (!lease.acquired) return lease.value;
  try {
    const cik = await identify(ticker);
    if (!cik) {
      await ref.set({ version: 1, value: null, refreshAfter: now + DAY });
      return null;
    }
    const submissions = await readJson<Parameters<typeof latestAnnualReport>[1]>(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const report = latestAnnualReport(cik, submissions);
    if (!report) {
      await ref.set({ version: 1, value: null, refreshAfter: now + DAY });
      return null;
    }
    const facts = await readJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    if (Number(facts.cik) !== Number(cik)) throw new Error("SEC company identity mismatch");
    let excerpt: string | null = null;
    if (report.form === "10-K") {
      try {
        const section = await db.collection("sec_filing_sections").doc(`${report.accession}_item1`).get();
        if (typeof section.get("text") === "string") excerpt = businessExcerpt(section.get("text"));
        if (!excerpt) {
          const sections = await fetchLatest10KSections(cik, { accessionNumber: report.accession, filingDate: report.filed, reportDate: report.end, primaryDocument: report.url.split("/").pop()!, filingUrl: report.url }, AbortSignal.timeout(12_000));
          excerpt = businessExcerpt(sections.find(item => item.id === "item1")?.text ?? "");
        }
      } catch { /* Financials remain useful when narrative extraction is unavailable. */ }
    }
    const value: CompanyFundamentals = { report, metrics: annualMetrics(facts, report), excerpt, fetchedAt: new Date().toISOString() };
    await ref.set({ version: 1, value, refreshAfter: now + DAY });
    return value;
  } catch {
    // Keep a dated, previously fetched snapshot during SEC outages. Retry on a later visit.
    await ref.set({ version: 1, value: lease.value ?? null, refreshAfter: now + 3_600_000 }, { merge: true }).catch(() => undefined);
    return lease.value;
  }
}

export function loadCompanyFundamentals(ticker: string): Promise<CompanyFundamentals | null> {
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) return Promise.resolve(null);
  const existing = pending.get(ticker);
  if (existing) return existing.then(withFreshness);
  const request = refreshCompanyFundamentals(ticker).catch(() => null).finally(() => pending.delete(ticker));
  pending.set(ticker, request);
  return request.then(withFreshness);
}

function withFreshness(value: CompanyFundamentals | null): CompanyFundamentals | null {
  return value ? { ...value, stale: Date.now() - Date.parse(value.fetchedAt) > 2 * DAY } : null;
}
