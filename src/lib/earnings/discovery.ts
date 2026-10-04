import { type EarningsKind, type EarningsSource, type SourceTime, sourceIdentity, validDate, validTimestamp } from "./model";
import { earningsCompany, validateSourceUrl } from "./issuers";
import { htmlToEarningsText } from "./document";

export function classifyEarningsTitle(title: string): EarningsKind | "calendar" | "unknown" {
  if (/披露的提示性公告|业绩(?:说明|交流)会|(?:召开|举行).*(?:说明会|电话会)|预约披露|to (?:report|announce|release)|will (?:report|announce|release)|earnings (?:call|conference).*?(?:date|schedule)/i.test(title)) return "calendar";
  if (/业绩预告|盈利预警|profit warning|earnings forecast|(?:updates?|revises?|raises?|lowers?|withdraws?).{0,35}(?:guidance|outlook)/i.test(title)) return "forecast";
  if (/业绩快报|preliminary (?:financial |earnings |operating )?results/i.test(title)) return "preliminary";
  if (/季度报告|半年度报告|年度报告|季度业绩|(?:financial|quarter|year|annual|interim).{0,40}results|results.{0,40}(?:quarter|year)/i.test(title)) return "actual";
  return "unknown";
}
// Input is the raw official submissions payload, BEFORE the existing scanner's
// financial-form filter. That shared scanner view still needs coordinated wiring.
// This pure adapter is not a second poller and does not widen its event contract.
export function discoverSecEarnings(companyId: string, payload: { cik?: unknown; filings?: { recent?: Record<string, unknown> } }, firstSeenAt: string): EarningsSource[] {
  const company = earningsCompany(companyId), recent = payload.filings?.recent;
  if (!company.cik || Number(payload.cik) !== Number(company.cik) || !recent || !Array.isArray(recent.form) || !validTimestamp(firstSeenAt)) throw new Error("Invalid SEC discovery identity or response");
  const keys = ["accessionNumber", "filingDate", "primaryDocument"];
  if (keys.some(key => !Array.isArray(recent[key]) || recent[key].length !== (recent.form as unknown[]).length)) throw new Error("Incomplete SEC discovery columns");
  const cell = (key: string, i: number) => Array.isArray(recent[key]) ? recent[key][i] : undefined;
  const output: EarningsSource[] = [];
  recent.form.forEach((form, i) => {
    if (!["8-K", "8-K/A", "6-K", "6-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A"].includes(String(form))) return;
    // Item 2.02 identifies results releases in domestic current reports. Missing
    // item metadata remains reviewable; unrelated known items do not consume
    // exhibit downloads when collection expands to the whole map.
    if (/^8-K(?:\/A)?$/.test(String(form)) && recent.items !== undefined) {
      if (!Array.isArray(recent.items) || recent.items.length !== (recent.form as unknown[]).length || typeof recent.items[i] !== 'string') throw new Error('Invalid SEC earnings item metadata');
      if (!recent.items[i].split(',').some((item: string) => item.trim() === '2.02')) return;
    }
    const accession = cell("accessionNumber", i), filingDate = cell("filingDate", i), primary = cell("primaryDocument", i);
    if (typeof accession !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !validDate(filingDate) || typeof primary !== "string" || !/^[\w.-]+$/.test(primary)) throw new Error("Invalid SEC filing row");
    const accepted = cell("acceptanceDateTime", i);
    // Do not turn filingDate or reportDate into an earnings announcement time.
    output.push({ provider: "sec", companyId, issuerId: company.issuerId, documentId: `${accession}/${primary}`,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${accession.replaceAll("-", "")}/${primary}`,
      title: `${company.name} ${form}`, form: String(form), accession, filingDate, filingAcceptedAt: validTimestamp(accepted) ? accepted : null,
      firstSeenAt, publishedAt: null, language: "en" });
  });
  return [...new Map(output.map(source => [sourceIdentity(source), source])).values()];
}
// Read the official filing index, not a guessed EX-99.1 filename. Caller obtains
// its bytes through the shared SEC transport after migration integration.
export function discoverSecExhibits(filing: EarningsSource, indexHtml: string): EarningsSource[] {
  if (filing.provider !== "sec" || !filing.accession) throw new Error("Expected SEC filing source");
  const root = new URL(".", filing.url), output: EarningsSource[] = [];
  for (const row of indexHtml.matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/gi)) {
    const label = htmlToEarningsText(row[1]);
    if (!/\bEX-99(?:\.\d+)?\b/i.test(label)) continue;
    const link = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/i.exec(row[1]);
    if (!link) continue;
    const url = new URL(link[1].replaceAll("&amp;", "&"), root);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || !/\.(?:html?|txt|pdf)$/i.test(url.pathname)) throw new Error("Unsafe SEC exhibit link");
    validateSourceUrl(filing.companyId, url.href, "sec");
    const name = url.pathname.split("/").at(-1)!;
    output.push({ ...filing, documentId: `${filing.accession}/${name}`, url: url.href, title: label });
  }
  return [...new Map(output.map(source => [sourceIdentity(source), source])).values()];
}
export type AnnouncementPage = { announcements?: unknown; hasMore?: unknown; totalAnnouncement?: unknown };
export function discoverCnEarnings(companyId: string, payload: AnnouncementPage, firstSeenAt: string): EarningsSource[] {
  const company = earningsCompany(companyId), code = companyId.split(":")[1];
  if (!company.cik && payload.announcements === null && payload.hasMore === false && payload.totalAnnouncement === 0 && validTimestamp(firstSeenAt)) return [];
  if (company.cik || !Array.isArray(payload.announcements) || typeof payload.hasMore !== "boolean" || !validTimestamp(firstSeenAt)) throw new Error("Invalid CNINFO page");
  const output: EarningsSource[] = [];
  for (const value of payload.announcements) {
    if (!value || typeof value !== "object") throw new Error("Malformed announcement");
    const row = value as Record<string, unknown>;
    if (row.secCode !== code) throw new Error("CNINFO issuer mismatch");
    if (typeof row.announcementTitle !== "string") throw new Error("Missing announcement title");
    const title = row.announcementTitle.replace(/<[^>]*>/g, "");
    const kind = classifyEarningsTitle(title);
    if (kind === "calendar" || kind === "unknown") continue;
    const id = row.announcementId, path = row.adjunctUrl;
    if (!/^\d+$/.test(String(id)) || typeof path !== "string" || !/^finalpage\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.pdf$/i.test(path)) throw new Error("Unsafe announcement document");
    const sourceDate = path.split("/")[1];
    if (!validDate(sourceDate)) throw new Error("Invalid announcement date");
    // CNINFO publication metadata can be date-only. Do not invent midnight UTC.
    const timestamp = row.announcementTime;
    const metadataDate = typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10) : null;
    const publishedAt: SourceTime | null = metadataDate && validDate(metadataDate)
      ? { value: metadataDate, precision: "date", timezone: "Asia/Shanghai" } : null;
    output.push({ provider: "cninfo", companyId, issuerId: company.issuerId, documentId: String(id),
      url: `https://static.cninfo.com.cn/${path}`, title, publishedAt, firstSeenAt, language: "zh" });
  }
  return output;
}
export async function collectCnEarningsPages(options: {
  companyId: string; firstSeenAt: string; fetchPage: (page: number) => Promise<AnnouncementPage>; maxPages?: number;
}) {
  const sources: EarningsSource[] = [], max = options.maxPages ?? 100;
  if (!Number.isInteger(max) || max < 1 || max > 1000) throw new Error("Invalid pagination limit");
  const pages = new Set<string>(), announcementIds = new Set<string>();
  let expectedTotal: number | undefined;
  for (let page = 1; page <= max; page++) {
    const response = await options.fetchPage(page);
    if (!Array.isArray(response.announcements)) throw new Error("Invalid announcement page");
    if (response.totalAnnouncement !== undefined) {
      if (typeof response.totalAnnouncement !== "number" || !Number.isSafeInteger(response.totalAnnouncement) || response.totalAnnouncement < 0) throw new Error("Invalid announcement total");
      if (expectedTotal !== undefined && expectedTotal !== response.totalAnnouncement) throw new Error("Announcement total changed: checkpoint not advanced");
      expectedTotal = response.totalAnnouncement;
    }
    if (!response.announcements.length && response.hasMore) throw new Error("Empty nonterminal page: checkpoint not advanced");
    const fingerprint = JSON.stringify(response.announcements);
    if (pages.has(fingerprint) && response.announcements.length) throw new Error("Repeated announcement page: checkpoint not advanced");
    for (const value of response.announcements) {
      const id = value && typeof value === "object" ? (value as Record<string, unknown>).announcementId : null;
      if (!/^\d+$/.test(String(id))) throw new Error("Announcement identity missing: checkpoint not advanced");
      if (announcementIds.has(String(id))) throw new Error("Overlapping announcement pages: checkpoint not advanced");
      announcementIds.add(String(id));
    }
    pages.add(fingerprint);
    sources.push(...discoverCnEarnings(options.companyId, response, options.firstSeenAt));
    if (!response.hasMore) {
      if (expectedTotal !== undefined && announcementIds.size !== expectedTotal) throw new Error("Announcement total incomplete: checkpoint not advanced");
      return { complete: true as const, pages: page, sources: [...new Map(sources.map(source => [sourceIdentity(source), source])).values()] };
    }
  }
  throw new Error("Announcement pagination incomplete: checkpoint not advanced");
}
