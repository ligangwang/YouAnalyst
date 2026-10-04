import { collectCnEarningsPages, classifyEarningsTitle, type AnnouncementPage } from "./discovery";
import { validateSource } from "./document";
import { datesInEvidence } from "./dates";
import { type ExtractionPlan, type MetricRule } from "./extract";
import { type EarningsKind, type Period, type RawEarningsDocument, sha256, validDate, validTimestamp } from "./model";
import { pilotCompany } from "./pilot";

const ORG_ENDPOINT = "https://www.cninfo.com.cn/new/information/topSearch/query";
const ANNOUNCEMENT_ENDPOINT = "https://www.cninfo.com.cn/new/hisAnnouncement/query";
const ENDPOINTS = new Set([ORG_ENDPOINT, ANNOUNCEMENT_ENDPOINT]);
export const CN_EARNINGS_ORGS = {
  "XSHG:688981": "gshk0000981", "XSHE:301308": "9900048787",
  "XSHG:688256": "nssc1000595", "XSHE:300308": "9900022016",
} as const; // Verified against CNINFO topSearch on 2026-10-02; rechecked on each discovery.
export type CnEarningsCompanyId = keyof typeof CN_EARNINGS_ORGS;
export type CnEarningsRequestContext = { operation: "cninfo_earnings_org" | "cninfo_earnings_announcements"; companyId: string };
export type CnEarningsJsonRequest = (url: string, init: RequestInit & CnEarningsRequestContext) => Promise<unknown>;
export type CnEarningsBlock = { host: string; code: number | string; retryAfter: string | null };
export class CnEarningsSourceError extends Error {
  constructor(message: string, readonly code: number | string, readonly host = "www.cninfo.com.cn", readonly retryAfter: string | null = null) { super(message); }
}

/** Public website transport, not a claim of licensed API access. No cookies or login.
 * The deployment injects a durable gate shared across earnings replicas and
 * document downloads. The legacy fundamentals requester retains its local limit.
 * beforeRequest runs before EVERY request (including redirects), and
 * onBlocked must persist 403/429 + Retry-After cooldowns before another run.
 * Local spacing/blockedHosts only protect one instance; they are not a global gate.
 */
export function createCnEarningsRequester(options: {
  fetcher?: typeof fetch; timeoutMs?: number; maxBytes?: number; spacingMs?: number;
  userAgent?: string;
  beforeRequest?: (context: CnEarningsRequestContext & { url: string; host: string }) => Promise<void>;
  onBlocked?: (block: CnEarningsBlock) => Promise<void>;
} = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000, maxBytes = options.maxBytes ?? 1_048_576, spacingMs = options.spacingMs ?? 1_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_097_152
    || !Number.isInteger(spacingMs) || spacingMs < 0 || spacingMs > 60_000) throw new Error("Invalid CNINFO transport bounds");
  const fetcher = options.fetcher ?? fetch, blocked = new Map<string, CnEarningsBlock>();
  let queue: Promise<void> = Promise.resolve(), lastStarted = 0;
  const request: CnEarningsJsonRequest = async (url, init) => {
    if (!ENDPOINTS.has(url)) throw new CnEarningsSourceError("Unapproved CNINFO endpoint", "UNSAFE_URL");
    const host = new URL(url).hostname;
    if (blocked.has(host)) throw new CnEarningsSourceError("CNINFO host blocked for this run", "HOST_SKIPPED");
    const prior = queue;
    let unlock!: () => void;
    queue = new Promise<void>(resolve => { unlock = resolve; });
    await prior;
    try {
      if (blocked.has(host)) throw new CnEarningsSourceError("CNINFO host blocked for this run", "HOST_SKIPPED");
      let current = url;
      const signal = AbortSignal.timeout(timeoutMs);
      for (let redirects = 0; redirects <= 2; redirects++) {
        const delay = spacingMs - (Date.now() - lastStarted);
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        await options.beforeRequest?.({ operation: init.operation, companyId: init.companyId, url: current, host });
        if (signal.aborted) throw new CnEarningsSourceError("CNINFO request timed out", "TIMEOUT");
        lastStarted = Date.now();
        const response = await fetcher(current, { method: "POST", body: init.body, signal, redirect: "manual", cache: "no-store", credentials: "omit",
          headers: { "user-agent": options.userAgent ?? "YouAnalyst/1.0 (company disclosures)", "content-type": "application/x-www-form-urlencoded; charset=UTF-8", referer: "https://www.cninfo.com.cn/new/disclosure" } });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const location = response.headers.get("location");
          const next = location ? new URL(location, current).href : "";
          // Preserve POST only for 307/308, and never leave the two reviewed endpoints.
          if (redirects === 2 || ![307, 308].includes(response.status) || !ENDPOINTS.has(next)) throw new CnEarningsSourceError("Unsafe CNINFO redirect", "UNSAFE_REDIRECT");
          current = next; continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new CnEarningsSourceError(`CNINFO request failed (${response.status})`, response.status, host, response.headers.get("retry-after")?.slice(0, 200) ?? null);
        }
        if (response.redirected || (response.url && response.url !== current)) {
          await response.body?.cancel();
          throw new CnEarningsSourceError("Unexpected CNINFO response URL", "UNSAFE_REDIRECT");
        }
        if (!/^application\/json\b/i.test(response.headers.get("content-type") ?? "")) {
          await response.body?.cancel();
          throw new CnEarningsSourceError("CNINFO did not return JSON", "INVALID_JSON");
        }
        const length = Number(response.headers.get("content-length"));
        if (length > maxBytes) { await response.body?.cancel(); throw new CnEarningsSourceError("CNINFO response exceeds byte limit", "TOO_LARGE"); }
        if (!response.body) throw new CnEarningsSourceError("CNINFO response body missing", "INVALID_JSON");
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw new CnEarningsSourceError("CNINFO response exceeds byte limit", "TOO_LARGE");
            chunks.push(value);
          }
        } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
        finally { reader.releaseLock(); }
        try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { throw new CnEarningsSourceError("CNINFO JSON could not be decoded", "INVALID_JSON"); }
      }
      throw new CnEarningsSourceError("CNINFO redirect limit exceeded", "UNSAFE_REDIRECT");
    } catch (cause) {
      const error = cause instanceof CnEarningsSourceError ? cause : new CnEarningsSourceError("CNINFO network or timeout failure", cause instanceof Error && /timeout|abort/i.test(cause.name) ? "TIMEOUT" : "NETWORK");
      if ([403, 429, "TIMEOUT", "NETWORK"].includes(error.code)) {
        const block = { host, code: error.code, retryAfter: error.retryAfter };
        blocked.set(host, block); await options.onBlocked?.(block);
      }
      throw error;
    } finally { unlock(); }
  };
  return { request, blockedHosts: () => Object.fromEntries(blocked) };
}

const form = (body: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(body).toString() });
function cnCompany(companyId: string): CnEarningsCompanyId {
  pilotCompany(companyId);
  if (!(companyId in CN_EARNINGS_ORGS)) throw new Error("Company is outside the mainland earnings pilot");
  return companyId as CnEarningsCompanyId;
}
export function parseCnEarningsOrg(companyId: string, payload: unknown): string {
  const id = cnCompany(companyId), code = id.split(":")[1];
  if (!Array.isArray(payload)) throw new Error("Invalid CNINFO issuer lookup");
  const matches = payload.filter(row => row && typeof row === "object" && row.code === code && row.category === "A股");
  if (matches.length !== 1 || matches[0].orgId !== CN_EARNINGS_ORGS[id] || !pilotCompany(id).aliases.some(alias => String(matches[0].zwjc ?? "").includes(alias))) throw new Error("CNINFO issuer lookup changed or ambiguous: review required");
  return matches[0].orgId as string;
}
export function createCnEarningsSources(request: CnEarningsJsonRequest) {
  return {
    async discover(options: { companyId: string; from: string; to: string; firstSeenAt: string; maxPages?: number }) {
      const companyId = cnCompany(options.companyId), code = companyId.split(":")[1], maxPages = options.maxPages ?? 10;
      if (!validDate(options.from) || !validDate(options.to) || options.from > options.to || !validTimestamp(options.firstSeenAt)
        || (Date.parse(options.to) - Date.parse(options.from)) / 86_400_000 > 366 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20) throw new Error("Invalid bounded CNINFO discovery window");
      const orgId = parseCnEarningsOrg(companyId, await request(ORG_ENDPOINT, { ...form({ keyWord: code, maxNum: "10" }), operation: "cninfo_earnings_org", companyId }));
      return collectCnEarningsPages({ companyId, firstSeenAt: options.firstSeenAt, maxPages, fetchPage: async page => {
        const payload = await request(ANNOUNCEMENT_ENDPOINT, { ...form({ pageNum: String(page), pageSize: "30", column: companyId.startsWith("XSHG:") ? "sse" : "szse",
          tabName: "fulltext", plate: "", stock: `${code},${orgId}`, searchkey: "", secid: "", category: "", trade: "", seDate: `${options.from}~${options.to}`,
          sortName: "", sortType: "", isHLtitle: "true" }), operation: "cninfo_earnings_announcements", companyId });
        if (!payload || typeof payload !== "object" || !Array.isArray((payload as AnnouncementPage).announcements) || ((payload as AnnouncementPage).announcements as unknown[]).length > 30
          || !Number.isSafeInteger((payload as AnnouncementPage).totalAnnouncement) || ((payload as AnnouncementPage).totalAnnouncement as number) < 0) throw new Error("Invalid bounded CNINFO page");
        for (const value of (payload as AnnouncementPage).announcements as unknown[]) {
          if (!value || typeof value !== "object") throw new Error("Invalid CNINFO announcement row");
          const row = value as Record<string, unknown>;
          if (row.orgId !== undefined && row.orgId !== orgId) throw new Error("CNINFO organisation mismatch");
        }
        return payload as AnnouncementPage;
      } });
    },
  };
}

const NUMBER = "\\(?[-−+]?\\d[\\d,]*(?:\\.\\d+)?\\)?";
const ACTUAL_CELLS = new RegExp(`^\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER}\\s*%?)\\s*$`);
const FORECAST_CELLS = new RegExp(`^\\s*(${NUMBER})\\s*[～~至]\\s*(${NUMBER})\\s+(${NUMBER})\\s*$`);
const REPORT_LABEL = /(20\d{2})\s*年\s*(第?一季度|半年度)\s*(报告|业绩快报|业绩预告)/g;
function reportPeriod(document: RawEarningsDocument): { period: Period; evidence: string; kind: EarningsKind } | null {
  const title = document.source.title;
  if (/摘要|英文|取消|撤销|说明|提示|预约|港股公告/.test(title)) return null;
  const labels = [...title.matchAll(REPORT_LABEL)];
  if (labels.length !== 1) return null;
  const label = labels[0], kind = classifyEarningsTitle(title);
  if (kind === "calendar" || kind === "unknown" || !/^(?:全文)?(?:[（(](?:修订|修正|更正|更新)(?:版|后)?[）)])?$/.test(title.slice(label.index! + label[0].length).replace(/\s/g, ""))) return null;
  const headingLabels = [...document.text.slice(0, 2500).matchAll(REPORT_LABEL)];
  const same = headingLabels.filter(match => match[1] === label[1] && match[2].replace("第", "") === label[2].replace("第", "") && match[3] === label[3]);
  if (!same.length || same[0] !== headingLabels[0] || headingLabels.some(match => match[1] !== label[1] || match[2].replace("第", "") !== label[2].replace("第", ""))) return null;
  const year = Number(label[1]), halfYear = label[2] === "半年度";
  return { period: { start: `${year}-01-01`, end: `${year}-${halfYear ? "06-30" : "03-31"}`, type: halfYear ? "half_year" : "quarter", fiscalYear: year, ...(!halfYear ? { fiscalQuarter: 1 } : {}) }, evidence: same[0][0], kind };
}

/** Only reviewed mainland statement table shapes. No company amounts or report
 * dates are embedded in the plan. Unrecognized/recast/ambiguous tables return
 * null, which the live collector must persist as review_required. H1 remains YTD.
 * The Shenzhen row label 元 is the reviewed domestic-report CNY convention;
 * an explicit foreign-currency marker always rejects that convention.
 */
export function makeCnEarningsPlan(document: RawEarningsDocument): ExtractionPlan | null {
  try {
    cnCompany(document.source.companyId); validateSource(document.source);
    if (document.source.provider !== "cninfo" || document.completeness !== "full" || document.mediaType !== "application/pdf" || document.textMethod !== "pdftotext-layout"
      || document.textSha256 !== sha256(document.text)) return null;
    const company = pilotCompany(document.source.companyId);
    if (!company.aliases.some(alias => document.text.slice(0, 2500).includes(alias))) return null;
    const report = reportPeriod(document);
    if (!report) return null;
    const base = { kind: report.kind, basis: "PRC_GAAP" as const, scope: "consolidated" as const };
    let metrics: MetricRule[] | null;
    if (report.kind === "forecast") metrics = forecastRules(document.text, base, report.period);
    else metrics = actualRules(document.text, base, report.period);
    return metrics ? { adapterVersion: "cn-live-1", period: report.period, periodEvidence: [report.evidence], periodStartDerivation: "Chinese report label: calendar year start; half-year is cumulative", kind: report.kind, metrics } : null;
  } catch { return null; }
}
function actualRules(text: string, base: Pick<MetricRule, "kind" | "basis" | "scope">, period: Period): MetricRule[] | null {
  const heading = /(?:[（(]\s*一\s*[）)]\s*|[一二三四五六七八九十]+、\s*(?:公司)?)(?:主要会计数据(?:和财务指标)?|主要财务数据和指标)[^\n]*\n/g;
  for (const match of text.slice(0, 100_000).matchAll(heading)) {
    const from = match.index!, bounded = text.slice(from, from + 2500);
    const row = /^\s*(营业收入(?:[（(]元[）)])?)[ \t]+([^\n]+)$/m.exec(bounded);
    if (!row) continue;
    const header = bounded.slice(0, row.index).trim();
    if (!header || header.length > 1900 || /母公司|分部|分行业|分产品|调整后|调整前|重述后|美元|港元|美金|USD|HKD/.test(header)) return null;
    const compact = header.replace(/\s/g, "");
    const monthRanges = [...header.matchAll(/[（(]\s*(\d{1,2})\s*[-－—~～至]\s*(\d{1,2})\s*月\s*[）)]/g)];
    if (monthRanges.some(range => Number(range[1]) !== 1 || Number(range[2]) !== (period.type === "half_year" ? 6 : 3))) return null;
    // Reject reordered or additional comparative columns. Header line wrapping is
    // permitted, but this table must explicitly compare this period to last year.
    if (!/本报告期/.test(compact) || !/上年同期/.test(compact) || !(/增/.test(compact) && /减|长/.test(compact))) return null;
    const currentColumns: number[] = [], previousColumns: number[] = [], comparisonColumns: number[] = [];
    for (const line of header.split("\n")) {
      for (const token of line.matchAll(/(^|\s)(本报告期|上年同期)(?=\s|[（(]|$)/g)) {
        (token[2] === "本报告期" ? currentColumns : previousColumns).push(token.index! + token[1].length);
      }
      const comparison = line.indexOf("本报告期比");
      if (comparison >= 0) comparisonColumns.push(comparison);
    }
    if (!currentColumns.some(current => previousColumns.some(previous => comparisonColumns.some(comparison => current < previous && previous < comparison)))) return null;
    const cells = ACTUAL_CELLS.exec(row[2]);
    if (!cells || (/%/.test(cells[3]) === false && !header.includes("%"))) return null;
    const after = bounded.slice(row.index + row[0].length);
    const next = /^\s*(利润总额|归属于上市公司股东的净利)/.exec(after);
    if (!next) return null;
    let unitEvidence: string, scale: number;
    if (row[1] !== "营业收入") {
      if (/单位[：:]\s*(?:千|万|亿)元/.test(header)) return null;
      unitEvidence = row[1]; scale = 1;
    }
    else {
      const units = [...header.matchAll(/单位[：:]\s*(千元|万元|元)\s+币种[：:]\s*人民币/g)];
      if (units.length !== 1) return null;
      unitEvidence = units[0][0]; scale = units[0][1] === "千元" ? 1000 : units[0][1] === "万元" ? 10000 : 1;
    }
    const common = { ...base, rowLabel: row[1], sectionStart: header, sectionEnd: next[1], header };
    return [
      { ...common, name: "revenue", label: "Revenue", currency: "CNY", scale, unit: "currency", unitEvidence },
      { ...common, name: "revenue_yoy", label: "Revenue YoY", currency: null, scale: 1, unit: "percent", valueIndex: 2 },
    ];
  }
  return null;
}
function forecastRules(text: string, base: Pick<MetricRule, "kind" | "basis" | "scope">, period: Period): MetricRule[] | null {
  const start = /一[、．.]\s*本期业绩预计情况/.exec(text.slice(0, 5000));
  if (!start) return null;
  const section = text.slice(start.index, start.index + 4000), end = /二[、．.]\s*业绩变动原因说明/.exec(section);
  if (!end) return null;
  const table = section.slice(0, end.index), rows = [...table.matchAll(/^\s*(营业收入)[ \t]+([^\n]+)$/gm)];
  const datedPeriod = /业绩预告期间[：:]([^\n]+)/.exec(table);
  const dates = datesInEvidence(datedPeriod?.[1] ?? "");
  if (dates.size !== 2 || !dates.has(period.start) || !dates.has(period.end)) return null;
  if (rows.length !== 1 || !FORECAST_CELLS.test(rows[0][2]) || !/本报告期\s+上年同期/.test(table) || !/单位[：:]\s*万元/.test(table) || !/人民币万元/.test(table)) return null;
  return [{ ...base, name: "revenue", label: "Revenue", rowLabel: "营业收入", sectionStart: start[0], sectionEnd: end[0], header: "本报告期", currency: "CNY", scale: 10000,
    unit: "currency", unitEvidence: "人民币万元", range: true }];
}
