import { randomUUID } from "node:crypto";
import { maintenanceError } from "../maintenance-log";
import { addDays, parseCninfoAnnouncements, parseCninfoDividends, resolveDistributions, parseCninfoListing, parseCninfoStructure, parseSseShareStructure, parseSzseAShareList,
  sourceFailed, type CnActionCheck, type CnListing, type CninfoStructure, type ExchangeCount } from "./cn-market-cap";

// Public official pages expect a browser-like client; no credentials are sent.
const USER_AGENT = "Mozilla/5.0 (compatible; YouAnalyst/1.0; +https://youanalyst.com)";
export const CN_ACTION_LOOKBACK_DAYS = 45;
type Context = { runId?: string; job?: string; company?: string };
export class CnSourceError extends Error {
  constructor(message: string, readonly code: number | string | null, readonly host: string) { super(message); }
}

// One queue for every provider request: at least `spacingMs` between requests.
export function createCnRequester(options: { spacingMs?: number; timeoutMs?: number; context?: Context; fetcher?: typeof fetch } = {}) {
  const spacing = options.spacingMs ?? 1_000;
  const fetcher = options.fetcher ?? fetch;
  let queue = Promise.resolve();
  const blocked = new Map<string, string>();
  const turn = async () => {
    const next = queue.then(() => new Promise<void>(resolve => setTimeout(resolve, spacing)));
    queue = next.catch(() => undefined);
    await next;
  };
  async function request(url: string, init: RequestInit & { operation: string; company?: string }) {
    const endpoint = new URL(url);
    // After a block, rate limit or network failure, skip the host for the rest of the run.
    if (blocked.has(endpoint.host)) throw new CnSourceError(`${endpoint.host} skipped after ${blocked.get(endpoint.host)}`, "HOST_SKIPPED", endpoint.host);
    await turn();
    const started = Date.now();
    const requestId = randomUUID();
    let response: Response | undefined;
    let phase: "request" | "http" | "decode" = "request";
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
    try {
      response = await fetcher(url, { ...init, signal: timeout, cache: "no-store", headers: { "user-agent": USER_AGENT, ...init.headers as Record<string, string> } });
      phase = "http";
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new CnSourceError(`${endpoint.host} request failed (${response.status})`, response.status, endpoint.host);
      }
      phase = "decode";
      return await response.json() as unknown;
    } catch (error) {
      const kind = timeout.aborted ? "timeout" : phase === "http" ? "http" : phase === "decode" ? "decode" : "network";
      const code = error instanceof CnSourceError ? error.code : null;
      if (kind === "network" || kind === "timeout" || code === 403 || code === 429) blocked.set(endpoint.host, `${kind}${code ? ` ${code}` : ""}`);
      // Never record query strings, request bodies or response bodies.
      console.error(JSON.stringify({ severity: "ERROR", message: "A-share source request failed", event: "cn_request_failed",
        timestamp: new Date().toISOString(), ...options.context, company: init.company, operation: init.operation, requestId,
        endpoint: `${endpoint.origin}${endpoint.pathname}`, method: init.method ?? "GET", kind, phase, status: response?.status ?? null,
        durationMs: Date.now() - started, retryAfter: response?.headers.get("retry-after")?.slice(0, 200) ?? null,
        revision: process.env.K_REVISION ?? process.env.GIT_SHA ?? "local", execution: process.env.CLOUD_RUN_EXECUTION ?? null,
        error: phase === "decode" && error instanceof SyntaxError ? { message: "invalid JSON" } : maintenanceError(error) }));
      if (error instanceof CnSourceError) throw error;
      throw new CnSourceError(`${endpoint.host} ${kind} failure`, kind === "decode" ? "INVALID_JSON" : kind === "timeout" ? "TIMEOUT" : "NETWORK", endpoint.host);
    }
  }
  return { request, blockedHosts: () => Object.fromEntries(blocked) };
}
export type CnRequester = ReturnType<typeof createCnRequester>;

const form = (data: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(data).toString(),
  headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", referer: "https://www.cninfo.com.cn/new/disclosure" } });

export function createCnSources(requester: CnRequester) {
  const { request } = requester;
  return {
    async structure(id: string, today: string): Promise<CninfoStructure | { reason: string }> {
      const code = id.split(":")[1];
      const url = `https://www.cninfo.com.cn/data20/stockholderCapital/getStockStructure?scode=${code}`;
      return parseCninfoStructure(await request(url, { operation: "cninfo_share_structure", company: id, headers: { referer: "https://www.cninfo.com.cn/new/disclosure/stock" } }), url, today);
    },
    async listing(id: string, checkedAt: string): Promise<CnListing | { reason: string }> {
      const code = id.split(":")[1];
      const url = `https://www.cninfo.com.cn/data20/companyOverview/getCompanyIntroduction?scode=${code}`;
      return parseCninfoListing(await request(url, { operation: "cninfo_company_overview", company: id, headers: { referer: "https://www.cninfo.com.cn/new/disclosure/stock" } }), code, url, checkedAt);
    },
    async exchange(id: string, today: string): Promise<ExchangeCount | { reason: string }> {
      const [exchange, code] = id.split(":");
      if (exchange === "XSHG") {
        const url = `https://query.sse.com.cn/commonQuery.do?isPagination=false&sqlId=COMMON_SSE_CP_GPJCTPZ_GPLB_GPGK_GBJG_C&companyCode=${code}&COMPANY_CODE=${code}`;
        return parseSseShareStructure(await request(url, { operation: "sse_share_structure", company: id, headers: { referer: "https://www.sse.com.cn/" } }), url);
      }
      const url = `https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&txtDMorJC=${code}`;
      return parseSzseAShareList(await request(url, { operation: "szse_a_share_list", company: id, headers: { referer: "https://www.szse.cn/market/product/stock/list/index.html" } }), code, url, today);
    },
    async orgId(id: string): Promise<string | null> {
      const code = id.split(":")[1];
      const rows = await request("https://www.cninfo.com.cn/new/information/topSearch/query", { ...form({ keyWord: code, maxNum: "10" }), operation: "cninfo_org_id", company: id });
      const match = Array.isArray(rows) ? (rows as Record<string, unknown>[]).filter(r => r.code === code && r.category === "A股" && typeof r.orgId === "string") : [];
      return match.length === 1 ? match[0].orgId as string : null;
    },
    // Share-changing announcements over the lookback window, across up to three pages.
    async actions(id: string, orgId: string, today: string, now = new Date()): Promise<CnActionCheck | { reason: string }> {
      const code = id.split(":")[1];
      const from = addDays(today, -CN_ACTION_LOOKBACK_DAYS);
      const events = [];
      for (let page = 1; page <= 3; page++) {
        const payload = await request("https://www.cninfo.com.cn/new/hisAnnouncement/query", { ...form({ pageNum: String(page), pageSize: "30", column: "szse",
          tabName: "fulltext", plate: "", stock: `${code},${orgId}`, searchkey: "", secid: "", category: "", trade: "", seDate: `${from}~${today}`,
          sortName: "", sortType: "", isHLtitle: "true" }), operation: "cninfo_announcements", company: id });
        const parsed = parseCninfoAnnouncements(payload, code);
        if (sourceFailed(parsed)) return parsed;
        events.push(...parsed);
        if ((payload as { hasMore?: unknown }).hasMore !== true) break;
        if (page === 3) return { reason: "too_many_announcements" };
      }
      // Dividend notices do not say whether shares are issued; the dividend record does.
      let resolved = events;
      if (events.some(e => e.kind === "distribution" || e.kind === "bonus_or_conversion")) {
        const dividends = parseCninfoDividends(await request(`https://www.cninfo.com.cn/data20/companyOverview/getCompanyHisDividend?scode=${code}`,
          { operation: "cninfo_dividends", company: id, headers: { referer: "https://www.cninfo.com.cn/new/disclosure/stock" } }));
        if (!sourceFailed(dividends)) resolved = resolveDistributions(events, dividends);
      }
      return { checkedAt: now.toISOString(), from, sourceUrl: `https://www.cninfo.com.cn/new/disclosure/stock?stockCode=${code}&orgId=${orgId}`,
        sourceType: "cninfo_announcements", events: resolved };
    },
  };
}
export type CnSources = ReturnType<typeof createCnSources>;
