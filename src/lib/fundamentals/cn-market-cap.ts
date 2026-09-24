// A-share share counts and market caps. Pure functions only: parsing official
// source payloads, corporate-action guards and the CNY/USD calculation.
// Fetching and storage live in cn-refresh.ts.

export const CN_METHOD = "a_close_x_total_shares";
export const CN_SHARE_REFRESH_DAYS = 7;
export const CN_MAX_SHARE_AGE_DAYS = 180;
export const CN_ACTION_CHECK_MAX_AGE_DAYS = 3;
export const CN_FX_LOOKBACK_DAYS = 7;
const DAY = 86_400_000;

export type CnShareCount = {
  aShares: number; aTradableShares: number; bShares: number; hShares: number | null; totalShares: number;
  // `date` is the day this structure took effect (the earliest price it applies to);
  // `asOf` is the latest day the sources confirmed it is still current.
  date: string; asOf: string; fetchedAt: string; sourceUrl: string; sourceType: string; changeReason: string | null;
  listing: { hCode: string | null; bCode: string | null; sourceUrl: string; sourceType: string };
  exchangeCheck: { domesticShares: number | null; date: string | null; sourceUrl: string | null; sourceType: string | null; status: string };
};
export type CnListing = { hCode: string | null; bCode: string | null; checkedAt: string; sourceUrl: string; sourceType: string };
export type CnActionKind = "bonus_or_conversion" | "distribution" | "placement" | "buyback_cancellation" | "share_change";
// `date` is the announcement date. `effectiveDate` is the ex-date when a dividend
// record confirms it; otherwise the announcement date is treated as effective.
export type CnCorporateAction = { date: string; settleBy: string; kind: CnActionKind; title: string; url: string;
  effectiveDate?: string; plan?: string };
export type CnDividend = { plan: string; recordDate: string | null; exDate: string };
export type CnActionCheck = { checkedAt: string; from: string; sourceUrl: string; sourceType: string; events: CnCorporateAction[] };
export type CnPrice = { ticker: string; market: string; tradingDate: string; close: number; currency?: string };
export type CnFx = { rate: number; date: string; source: string } | null;
export type CnMarketCap = {
  status: "estimated" | "unavailable"; value: number | null; currency: "CNY";
  usd: { value: number; rate: number; rateDate: string; source: string } | null;
  priceDate: string | null; close: number | null; lastClose: boolean;
  shares: CnShareCount | null; method: typeof CN_METHOD; reason: string | null; usdReason: string | null; calculatedAt: string;
};

export const isoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY;
// Chinese sources publish calendar dates in Beijing time.
export const shanghaiDate = (at: Date | number = new Date()) => new Date(new Date(at).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

type Parsed<T> = T | { reason: string };
// A failure is exactly `{ reason }`; parsed values never use that shape.
const failed = <T>(value: Parsed<T>): value is { reason: string } => typeof value === "object" && value !== null
  && Object.keys(value).length === 1 && typeof (value as { reason?: unknown }).reason === "string";
export { failed as sourceFailed };

// "1,984,409.23" → 1984409.23; rejects blanks, dashes and anything non-numeric.
function decimal(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.replaceAll(",", "").trim();
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}
const shares = (value: number, unit: number) => Math.round(value * unit);

// Reasons that are validated facts about the company, not source problems: the
// payloads parsed and checked out, and they prove the count cannot be used.
// Every other reason (malformed, changed or error payloads) is a retryable failure.
export const CN_UNAVAILABLE_REASONS: ReadonlySet<string> = new Set(["h_share_count_unavailable", "b_share_count_unavailable",
  "exchange_share_count_mismatch", "cdr_share_structure_unsupported"]);

// cninfo share structure (股本结构): data20/stockholderCapital/getStockStructure.
// Records are newest first, in 10,000 shares (万股) with four decimals, dated by
// VARYDATE (the day the structure took effect). F003N total, F022N tradable
// RMB ordinary shares, F023N B shares, F024N overseas-listed (H) shares, F028N restricted.
export type CninfoStructure = { totalShares: number; aShares: number; aTradableShares: number; bShares: number; hShares: number;
  date: string; changeReason: string | null; sourceUrl: string; sourceType: string };
export function parseCninfoStructure(payload: unknown, sourceUrl: string, today: string): Parsed<CninfoStructure> {
  const data = (payload as { code?: unknown; data?: { resultMsg?: unknown; records?: unknown } })?.data;
  if (!data || data.resultMsg !== "success" || !Array.isArray(data.records)) return { reason: "unrecognized_source_format" };
  // Records without the expected fields mean the schema changed, not that data is missing.
  if (data.records.length && !(data.records as Record<string, unknown>[]).some(r => "VARYDATE" in r && "F003N" in r)) return { reason: "unrecognized_source_format" };
  const rows = (data.records as Record<string, unknown>[]).filter(r => isoDate(r.VARYDATE) && r.VARYDATE <= today)
    .sort((x, y) => String(y.VARYDATE).localeCompare(String(x.VARYDATE)));
  if (!rows.length) return { reason: "missing_share_structure" };
  const latest = rows[0];
  if (rows.filter(r => r.VARYDATE === latest.VARYDATE).some(r => r.F003N !== latest.F003N)) return { reason: "ambiguous_share_structure" };
  const optional = (v: unknown) => v === null || v === undefined ? 0 : decimal(v);
  const total = decimal(latest.F003N), tradableA = decimal(latest.F022N);
  const b = optional(latest.F023N), h = optional(latest.F024N), restricted = optional(latest.F028N);
  if (total === null || tradableA === null || b === null || h === null || restricted === null) return { reason: "unrecognized_source_format" };
  const [totalShares, aTradableShares, bShares, hShares, restrictedShares] = [total, tradableA, b, h, restricted].map(v => shares(v, 10_000));
  // Every class must reconcile with the reported total (four-decimal 万股 = whole shares).
  if (Math.abs(aTradableShares + bShares + hShares + restrictedShares - totalShares) > 4) return { reason: "inconsistent_share_structure" };
  const aShares = totalShares - bShares - hShares;
  if (!Number.isSafeInteger(totalShares) || totalShares <= 0 || aShares <= 0 || aTradableShares > aShares) return { reason: "invalid_share_count" };
  return { totalShares, aShares, aTradableShares, bShares, hShares, date: latest.VARYDATE as string,
    changeReason: typeof latest.F002V === "string" ? latest.F002V.slice(0, 100) : null, sourceUrl, sourceType: "cninfo_share_structure" };
}

// Exchange cross-check: A (+B) shares as published by the listing exchange itself.
export type ExchangeCount = { domesticShares: number; aTradableShares: number | null; date: string; sourceUrl: string; sourceType: string; tolerance: number };

// SSE share structure (股本结构): query.sse.com.cn sqlId COMMON_SSE_CP_GPJCTPZ_GPLB_GPGK_GBJG_C.
// Values are in 万股 with two decimals (±100 shares), dated by TRADE_DATE (YYYYMMDD).
export function parseSseShareStructure(payload: unknown, sourceUrl: string): Parsed<ExchangeCount> {
  const rows = (payload as { result?: unknown })?.result;
  if (!Array.isArray(rows)) return { reason: "unrecognized_source_format" };
  if (rows.length !== 1) return { reason: rows.length ? "ambiguous_share_structure" : "missing_share_structure" };
  const row = rows[0] as Record<string, unknown>;
  const [total, restricted, tradable, b] = ["TOTAL_DOMESTIC_VOL", "A_LIMIT_VOL", "A_UNLIMIT_VOL", "B_VOL"].map(k => decimal(row[k]));
  const cdr = decimal(row.CDR_VOL) ?? 0;
  const date = typeof row.TRADE_DATE === "string" && /^\d{8}$/.test(row.TRADE_DATE)
    ? `${row.TRADE_DATE.slice(0, 4)}-${row.TRADE_DATE.slice(4, 6)}-${row.TRADE_DATE.slice(6)}` : null;
  if (total === null || restricted === null || tradable === null || b === null || !isoDate(date)) return { reason: "unrecognized_source_format" };
  if (cdr > 0) return { reason: "cdr_share_structure_unsupported" };
  if (Math.abs(restricted + tradable + b - total) > 0.011) return { reason: "inconsistent_share_structure" };
  const domesticShares = shares(total, 10_000);
  if (domesticShares <= 0 || !Number.isSafeInteger(domesticShares)) return { reason: "invalid_share_count" };
  return { domesticShares, aTradableShares: shares(tradable, 10_000), date, sourceUrl, sourceType: "sse_share_structure", tolerance: 100 };
}

// SZSE A-share list (CATALOGID=1110, tab1) JSON. Columns are located by their
// published labels (A股总股本 / A股流通股本), not only by internal keys. This page
// was unreachable from US networks when implemented; the job treats it as a
// best-effort cross-check and fails closed if it disagrees with cninfo.
export function parseSzseAShareList(payload: unknown, code: string, sourceUrl: string, today: string): Parsed<ExchangeCount> {
  const tabs = Array.isArray(payload) ? payload : [];
  const tab = tabs.find(t => Array.isArray((t as { data?: unknown })?.data)) as { data: Record<string, unknown>[]; metadata?: { cols?: Record<string, string> } } | undefined;
  if (!tab) return { reason: "unrecognized_source_format" };
  const cols = tab.metadata?.cols ?? {};
  const key = (label: string, fallback: string) => Object.entries(cols).find(([, v]) => typeof v === "string" && v.replace(/<[^>]*>/g, "").startsWith(label))?.[0] ?? fallback;
  const codeKey = key("A股代码", "agdm"), totalKey = key("A股总股本", "agzgb"), tradableKey = key("A股流通股本", "agltgb");
  const unit = (label: string) => /亿股/.test(label) ? 100_000_000 : /万股/.test(label) ? 10_000 : 1;
  const rows = tab.data.filter(r => String(r[codeKey] ?? "").replace(/<[^>]*>/g, "").trim() === code);
  if (rows.length !== 1) return { reason: rows.length ? "ambiguous_share_structure" : "missing_share_structure" };
  const total = decimal(rows[0][totalKey]), tradable = decimal(rows[0][tradableKey]);
  if (total === null || tradable === null) return { reason: "unrecognized_source_format" };
  const domesticShares = shares(total, unit(cols[totalKey] ?? "")), aTradableShares = shares(tradable, unit(cols[tradableKey] ?? ""));
  if (domesticShares <= 0 || aTradableShares > domesticShares || !Number.isSafeInteger(domesticShares)) return { reason: "inconsistent_share_structure" };
  // The list is a current snapshot without its own date.
  return { domesticShares, aTradableShares, date: today, sourceUrl, sourceType: "szse_a_share_list", tolerance: unit(cols[totalKey] ?? "") / 2 + 1 };
}

// cninfo company overview: official A/B/H security codes for the issuer.
export function parseCninfoListing(payload: unknown, code: string, sourceUrl: string, checkedAt: string): Parsed<CnListing> {
  const records = (payload as { data?: { records?: unknown } })?.data?.records;
  const info = Array.isArray(records) ? (records[0] as { basicInformation?: unknown })?.basicInformation : null;
  const row = Array.isArray(info) && info.length === 1 ? info[0] as Record<string, unknown> : null;
  if (!row || row.ASECCODE !== code) return { reason: "listing_identity_unavailable" };
  const clean = (v: unknown, pattern: RegExp) => typeof v === "string" && pattern.test(v.trim()) ? v.trim() : null;
  return { hCode: clean(row.HSECCODE, /^\d{4,5}$/), bCode: clean(row.BSECCODE, /^\d{6}$/), checkedAt, sourceUrl, sourceType: "cninfo_company_overview" };
}

// Titles of announcements that change the share count. Cash-only dividend titles
// cannot be told apart from bonus/conversion issues reliably, so any distribution
// implementation notice is treated as a possible share change until re-verified.
const ACTIONS: [CnActionKind, RegExp, number][] = [
  ["bonus_or_conversion", /转增股本|送股|送红股|送转/, 15],
  ["distribution", /(权益分派|利润分配|分红派息|分配方案).*实施/, 15],
  ["placement", /新增股份.*上市|上市公告书|发行结果暨股本变动|发行情况报告书|配股.*(上市|结果)/, 5],
  ["buyback_cancellation", /回购.*(注销|股份变动)|注销.*回购|减少注册资本.*完成/, 5],
  ["share_change", /股份变动|股本变动|股本结构变动|限制性股票.*(登记完成|授予结果|归属结果|上市流通)/, 5],
];
const EXCLUDED = /提示性公告|预案|草案|方案的公告|问询|法律意见|核查意见|独立财务顾问|摘要|英文|更正|取消|终止/;

export function classifyAnnouncement(title: string): { kind: CnActionKind; settleDays: number } | null {
  const text = title.replace(/<[^>]*>/g, "");
  if (EXCLUDED.test(text) && !/实施|完成|结果|上市公告书/.test(text)) return null;
  const match = ACTIONS.find(([, pattern]) => pattern.test(text));
  return match ? { kind: match[0], settleDays: match[2] } : null;
}

export function parseCninfoAnnouncements(payload: unknown, code: string): Parsed<CnCorporateAction[]> {
  const list = (payload as { announcements?: unknown })?.announcements;
  if (list === null) return [];
  if (!Array.isArray(list)) return { reason: "unrecognized_source_format" };
  const events: CnCorporateAction[] = [];
  for (const item of list as Record<string, unknown>[]) {
    if (item.secCode !== code || typeof item.announcementTitle !== "string" || typeof item.announcementTime !== "number") continue;
    const kind = classifyAnnouncement(item.announcementTitle);
    if (!kind) continue;
    const date = shanghaiDate(item.announcementTime);
    const path = typeof item.adjunctUrl === "string" && /^finalpage\/[\w/.-]+$/.test(item.adjunctUrl) ? item.adjunctUrl : null;
    events.push({ date, settleBy: addDays(date, kind.settleDays), kind: kind.kind, title: item.announcementTitle.replace(/<[^>]*>/g, "").slice(0, 200),
      url: path ? `https://static.cninfo.com.cn/${path}` : "https://www.cninfo.com.cn/new/disclosure" });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

// Combine the issuer structure with listing identity and the exchange's own count.
// A+H (or B) companies need every class: total market cap = A close × all issued shares.
export function combineShareCount(input: { structure: CninfoStructure; listing: CnListing | null;
  exchange: ExchangeCount | null; exchangeStatus: string; fetchedAt: string; today: string }): Parsed<CnShareCount> {
  const { structure, listing, exchange } = input;
  if (!listing) return { reason: "listing_identity_unavailable" };
  if (listing.hCode && structure.hShares <= 0) return { reason: "h_share_count_unavailable" };
  if (listing.bCode && structure.bShares <= 0) return { reason: "b_share_count_unavailable" };
  // The exchange snapshot is at least as new as the issuer structure; a mismatch
  // means one side has not caught up with a change yet.
  if (exchange && Math.abs(exchange.domesticShares - (structure.aShares + structure.bShares)) > exchange.tolerance) return { reason: "exchange_share_count_mismatch" };
  return { aShares: structure.aShares, aTradableShares: structure.aTradableShares, bShares: structure.bShares,
    hShares: structure.hShares > 0 ? structure.hShares : null, totalShares: structure.totalShares,
    date: structure.date, asOf: input.today, fetchedAt: input.fetchedAt, sourceUrl: structure.sourceUrl, sourceType: structure.sourceType,
    changeReason: structure.changeReason, listing: { hCode: listing.hCode, bCode: listing.bCode, sourceUrl: listing.sourceUrl, sourceType: listing.sourceType },
    exchangeCheck: exchange ? { domesticShares: exchange.domesticShares, date: exchange.date, sourceUrl: exchange.sourceUrl, sourceType: exchange.sourceType, status: "matched" }
      : { domesticShares: null, date: null, sourceUrl: null, sourceType: null, status: input.exchangeStatus } };
}

// A share-changing event is settled once the stored structure took effect on or
// after its ex-date, or the count was re-verified after the settlement window.
export function actionSettled(count: Pick<CnShareCount, "asOf" | "date">, event: CnCorporateAction) {
  return Boolean(event.effectiveDate && count.date >= event.effectiveDate) || count.asOf >= event.settleBy;
}
// Events that have taken effect by `onOrBefore` but may not be in the stored count.
export function pendingActions(count: Pick<CnShareCount, "asOf" | "date">, check: CnActionCheck | null, onOrBefore: string) {
  return (check?.events ?? []).filter(event => (event.effectiveDate ?? event.date) <= onOrBefore && !actionSettled(count, event));
}

export function shareRefreshDue(count: CnShareCount | null, check: CnActionCheck | null, today: string) {
  if (!count) return "missing";
  if (daysBetween(count.asOf, today) >= CN_SHARE_REFRESH_DAYS) return "stale";
  // Re-verify daily while an event that has taken effect is not reflected yet.
  if (count.asOf < today && pendingActions(count, check, today).length) return "corporate_action";
  return null;
}

// cninfo dividend history (分红): F007V plan (e.g. "10转增4股派4.5元(含税)"),
// F018D record date, F020D ex-date.
export function parseCninfoDividends(payload: unknown): CnDividend[] | { reason: string } {
  const data = (payload as { data?: { resultMsg?: unknown; records?: unknown } })?.data;
  if (!data || data.resultMsg !== "success" || !Array.isArray(data.records)) return { reason: "unrecognized_source_format" };
  return (data.records as Record<string, unknown>[]).flatMap(r => typeof r.F007V === "string" && isoDate(r.F020D)
    ? [{ plan: r.F007V.slice(0, 100), recordDate: isoDate(r.F018D) ? r.F018D : null, exDate: r.F020D }] : []);
}

// Resolve generic distribution notices with the dividend record they implement:
// cash-only payouts do not change the share count; bonus or conversion issues
// take effect on their ex-date. Unmatched notices stay conservative.
export function resolveDistributions(events: CnCorporateAction[], dividends: CnDividend[]): CnCorporateAction[] {
  return events.flatMap(event => {
    if (event.kind !== "distribution" && event.kind !== "bonus_or_conversion") return [event];
    const matches = dividends.filter(d => d.exDate >= event.date && daysBetween(event.date, d.exDate) <= 30);
    if (matches.length !== 1) return [event];
    const { plan, exDate } = matches[0];
    if (!/送|转增|转\d/.test(plan)) return [];
    return [{ ...event, kind: "bonus_or_conversion" as const, effectiveDate: exDate, settleBy: addDays(exDate, 5), plan }];
  });
}

// Latest USD/CNY close on or before the price date, within the lookback.
export function selectFx(rates: { date: string; close: number; source?: string }[], priceDate: string): CnFx {
  const candidates = rates.filter(r => isoDate(r.date) && r.date <= priceDate && daysBetween(r.date, priceDate) <= CN_FX_LOOKBACK_DAYS
    && typeof r.close === "number" && Number.isFinite(r.close) && r.close > 0).sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0] ? { rate: candidates[0].close, date: candidates[0].date, source: candidates[0].source ?? "eodhd-eod" } : null;
}

export function calculateCnMarketCap(input: { id: string; count: CnShareCount | null; countReason?: string | null; check: CnActionCheck | null;
  price: CnPrice | undefined; latestSession: string | null; fx: CnFx; now?: Date }): CnMarketCap {
  const now = input.now ?? new Date();
  const today = shanghaiDate(now);
  const result: CnMarketCap = { status: "unavailable", value: null, currency: "CNY", usd: null, priceDate: null, close: null, lastClose: false,
    shares: input.count, method: CN_METHOD, reason: input.countReason ?? (input.count ? null : "shares_not_yet_refreshed"), usdReason: null,
    calculatedAt: now.toISOString() };
  const p = input.price;
  if (!p || p.ticker !== input.id || p.market !== "CN_A" || !isoDate(p.tradingDate) || p.tradingDate > today
    || typeof p.close !== "number" || !Number.isFinite(p.close) || p.close <= 0) return { ...result, reason: "missing_or_invalid_cached_price" };
  // Suspended stocks keep their last close, labelled with its own date.
  const lastClose = Boolean(input.latestSession && p.tradingDate < input.latestSession);
  Object.assign(result, { priceDate: p.tradingDate, close: p.close, lastClose });
  const count = input.count;
  // An explicit unavailable outcome from the latest refresh outranks an older count.
  if (!count || input.countReason) return result;
  if (count.date > p.tradingDate) return { ...result, reason: "share_count_newer_than_price" };
  if (daysBetween(count.asOf, today) > CN_MAX_SHARE_AGE_DAYS) return { ...result, reason: "stale_share_count" };
  if (!input.check || daysBetween(shanghaiDate(Date.parse(input.check.checkedAt)), today) > CN_ACTION_CHECK_MAX_AGE_DAYS) {
    return { ...result, reason: "corporate_action_check_unavailable" };
  }
  if (pendingActions(count, input.check, p.tradingDate).length) return { ...result, reason: "corporate_action_after_share_count" };
  const value = p.close * count.totalShares;
  if (!Number.isFinite(value) || value <= 0) return { ...result, reason: "invalid_calculation" };
  const fx = input.fx;
  const usd = fx && fx.rate > 0 ? { value: value / fx.rate, rate: fx.rate, rateDate: fx.date, source: fx.source } : null;
  return { ...result, status: "estimated", value, reason: null, usd, usdReason: usd ? null : "missing_fx_rate" };
}
