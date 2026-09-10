export type SecCompanyIdentity = {
  cik: string;
  name: string;
  ticker: string;
  exchange: string | null;
};

export type SecLatest10K = {
  accessionNumber: string;
  filingDate: string;
  reportDate: string | null;
  primaryDocument: string;
  filingUrl: string;
};

export type SecFilingSection = {
  id: "item1" | "item1a";
  title: string;
  text: string;
};

type SecCompanyTickersResponse = {
  fields?: unknown;
  data?: unknown;
};

type SecSubmissionsResponse = {
  filings?: {
    recent?: Record<string, unknown>;
  };
};

const SEC_BASE_URL = "https://www.sec.gov";
const SEC_DATA_BASE_URL = "https://data.sec.gov";
const SECTION_STORE_CHAR_LIMIT = 300_000;
const ITEM_1_EXTRACTION_CHAR_LIMIT = 80_000;
const ITEM_1A_EXTRACTION_CHAR_LIMIT = 8_000;

function getSecUserAgent(): string {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (userAgent) {
    return userAgent;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://youanalyst.com";
  return `YouAnalyst company graph ${appUrl}`;
}

async function fetchSecJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": getSecUserAgent(),
    },
  });

  if (!response.ok) {
    throw new Error(`SEC request failed (${response.status}): ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchSecText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    signal,
    headers: {
      accept: "text/html,application/xhtml+xml,text/plain",
      "user-agent": getSecUserAgent(),
    },
  });

  if (!response.ok) {
    throw new Error(`SEC filing download failed (${response.status}): ${url}`);
  }

  return response.text();
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

function unpadCik(cik: string): string {
  return String(Number(cik));
}

function readRecentColumn(recent: Record<string, unknown>, key: string): string[] {
  const value = recent[key];
  return Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
}

function filingDocumentUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const accessionPath = accessionNumber.replace(/-/g, "");
  return `${SEC_BASE_URL}/Archives/edgar/data/${unpadCik(cik)}/${accessionPath}/${primaryDocument}`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function stripSecMetadata(html: string): string {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
    .replace(/<xbrli:context[\s\S]*?<\/xbrli:context>/gi, " ")
    .replace(/<xbrli:unit[\s\S]*?<\/xbrli:unit>/gi, " ")
    .replace(/<link:schemaRef\b[^>]*\/?>/gi, " ");
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    stripSecMetadata(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|section|article|tr|table|h[1-6]|li)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function normalizeHtmlTextForSearch(html: string): string {
  return decodeHtmlEntities(
    stripSecMetadata(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findElementByIdIndex(html: string, id: string): number {
  const pattern = new RegExp(`\\bid\\s*=\\s*["']${escapeRegExp(id)}["']`, "i");
  const match = pattern.exec(html);
  if (!match) {
    return -1;
  }

  const tagStart = html.lastIndexOf("<", match.index);
  return tagStart >= 0 ? tagStart : match.index;
}

function findTocAnchorIndex(
  html: string,
  titlePattern: RegExp,
  itemMarkerPattern: RegExp,
): number {
  const linkPattern = /<a\b[^>]*\bhref\s*=\s*["']#([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = linkPattern.exec(html);

  while (match) {
    const [, anchorId, linkHtml] = match;
    const linkText = normalizeHtmlTextForSearch(linkHtml);
    if (titlePattern.test(linkText)) {
      const nearbyHtml = html.slice(Math.max(0, match.index - 1_200), match.index + 1_200);
      const nearbyText = normalizeHtmlTextForSearch(nearbyHtml);
      if (itemMarkerPattern.test(nearbyText)) {
        const anchorIndex = findElementByIdIndex(html, anchorId);
        if (anchorIndex > match.index) {
          return anchorIndex;
        }
      }
    }

    match = linkPattern.exec(html);
  }

  return -1;
}

function extractHtmlSlice(html: string, start: number, endCandidates: number[]): string {
  if (start < 0) {
    return "";
  }

  const end = endCandidates.filter((index) => index > start).sort((a, b) => a - b)[0] ?? Math.min(html.length, start + 300_000);
  return htmlToText(html.slice(start, end));
}

function extractAnchoredSections(html: string): SecFilingSection[] | null {
  const item1Start = findTocAnchorIndex(html, /^business$/, /\bitem\s*1\b(?!\s*[a-z])/);
  const item1AStart = findTocAnchorIndex(html, /^risk factors?$/, /\bitem\s*1a\b/);
  const item1BStart = findTocAnchorIndex(html, /^unresolved staff comments?$/, /\bitem\s*1b\b/);
  const item1CStart = findTocAnchorIndex(html, /^cybersecurity$/, /\bitem\s*1c\b/);
  const item2Start = findTocAnchorIndex(html, /^properties$/, /\bitem\s*2\b/);

  if (item1Start < 0 && item1AStart < 0) {
    return null;
  }

  return [
    {
      id: "item1",
      title: "Item 1. Business",
      text: extractHtmlSlice(html, item1Start, [item1AStart, item1BStart, item1CStart, item2Start]),
    },
    {
      id: "item1a",
      title: "Item 1A. Risk Factors",
      text: extractHtmlSlice(html, item1AStart, [item1BStart, item1CStart, item2Start]),
    },
  ];
}

function normalizeSectionMarker(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.\-–—:]/g, "")
    .trim();
}

function isLikelyTableOfContentsMarker(text: string, index: number): boolean {
  const earlyDocumentLimit = Math.min(50_000, Math.floor(text.length * 0.25));
  if (index > earlyDocumentLimit) {
    return false;
  }

  const nearbyText = text.slice(index, index + 1_500);
  const nearbyItemMarkers = nearbyText.match(/(?:^|\n)\s*item\s+(?:1a?|1b|[2-9]|1[0-6])[\s.\-–—:]+/gi) ?? [];

  return nearbyItemMarkers.length >= 3;
}

function findSectionStart(text: string, labels: string[], fromIndex = 0): number {
  const markerPattern = /(?:^|\n)\s*item\s+(?:1a?|1b|2)[\s.\-–—:]+[^\n]{0,120}/gi;
  markerPattern.lastIndex = fromIndex;

  let match = markerPattern.exec(text);
  while (match) {
    const marker = normalizeSectionMarker(match[0]);
    if (labels.some((label) => marker.startsWith(label)) && !isLikelyTableOfContentsMarker(text, match.index)) {
      return match.index;
    }
    match = markerPattern.exec(text);
  }

  return -1;
}

function extractSection(text: string, id: "item1" | "item1a", title: string): SecFilingSection {
  const item1Start = findSectionStart(text, ["item 1 business"]);
  const item1AStart = findSectionStart(text, ["item 1a risk factors"], Math.max(0, item1Start + 20));
  const item1BStart = findSectionStart(text, ["item 1b unresolved"], Math.max(0, item1AStart + 20));
  const item2Start = findSectionStart(text, ["item 2 properties"], Math.max(0, (item1AStart > 0 ? item1AStart : item1Start) + 20));

  if (id === "item1") {
    const start = item1Start >= 0 ? item1Start : 0;
    const endCandidates = [item1AStart, item2Start].filter((index) => index > start);
    const end = endCandidates.length ? Math.min(...endCandidates) : Math.min(text.length, start + 120_000);
    return { id, title, text: text.slice(start, end).trim() };
  }

  if (item1AStart < 0) {
    return { id, title, text: "" };
  }

  const endCandidates = [item1BStart, item2Start].filter((index) => index > item1AStart);
  const end = endCandidates.length ? Math.min(...endCandidates) : Math.min(text.length, item1AStart + 120_000);
  return { id, title, text: text.slice(item1AStart, end).trim() };
}

function relationshipSnippets(text: string, charLimit: number): string {
  const keywords = [
    "supplier",
    "vendor",
    "foundr",
    "wafer",
    "fabricat",
    "manufactur",
    "assembly",
    "packag",
    "subcontract",
    "outsourc",
    "production",
    "customer",
    "compet",
    "partner",
    "depend",
    "distribution",
    "contract",
  ];
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const candidates: Array<{ text: string; priority: number; sourceIndex: number }> = [];
  let charCount = 0;

  for (const [sourceIndex, paragraph] of paragraphs.entries()) {
    const lower = paragraph.toLowerCase();
    const matchedPriority = keywords.findIndex((keyword) => lower.includes(keyword));
    if (matchedPriority < 0) {
      continue;
    }

    const matchedKeyword = keywords[matchedPriority];
    const keywordIndex = lower.indexOf(matchedKeyword);
    const snippetStart = paragraph.length > 2_000 ? Math.max(0, keywordIndex - 650) : 0;
    const next = paragraph.slice(snippetStart, snippetStart + 2_000).trim();
    if (!next) {
      continue;
    }

    candidates.push({
      text: next,
      priority: matchedPriority,
      sourceIndex,
    });
  }

  const selected: string[] = [];
  const seen = new Set<string>();
  const sortedCandidates = candidates.sort((left, right) => {
    const priorityDelta = left.priority - right.priority;
    return priorityDelta !== 0 ? priorityDelta : left.sourceIndex - right.sourceIndex;
  });

  for (const candidate of sortedCandidates) {
    const dedupeKey = candidate.text.toLowerCase().slice(0, 300);
    if (seen.has(dedupeKey)) {
      continue;
    }

    const next = candidate.text;
    if (charCount + next.length > charLimit) {
      continue;
    }

    seen.add(dedupeKey);
    selected.push(next);
    charCount += next.length;
  }

  return selected.join("\n\n");
}

export function buildCompanyGraphExtractionText(sections: SecFilingSection[]): string {
  const item1 = sections.find((section) => section.id === "item1")?.text ?? "";
  const item1a = sections.find((section) => section.id === "item1a")?.text ?? "";
  const businessRelationshipText = item1.slice(0, ITEM_1_EXTRACTION_CHAR_LIMIT);
  const riskRelationshipText = relationshipSnippets(item1a, ITEM_1A_EXTRACTION_CHAR_LIMIT);

  return [
    "SECTION item1 Business full text",
    businessRelationshipText,
    riskRelationshipText ? "SECTION item1a Risk Factors relationship snippets" : "",
    riskRelationshipText,
  ].join("\n\n").trim();
}

export function summarizeStoredSections(sections: SecFilingSection[]) {
  return sections.map((section) => {
    const storedText = section.text.slice(0, SECTION_STORE_CHAR_LIMIT);
    return {
      id: section.id,
      title: section.title,
      text: storedText,
      available: section.text.length > 0,
      charCount: section.text.length,
      storedCharCount: storedText.length,
      truncated: section.text.length > storedText.length,
    };
  });
}

export async function resolveSecCompanyByTicker(ticker: string): Promise<SecCompanyIdentity> {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    throw new Error("Ticker is required.");
  }

  const payload = await fetchSecJson<SecCompanyTickersResponse>(`${SEC_BASE_URL}/files/company_tickers_exchange.json`);
  const fields = Array.isArray(payload.fields) ? payload.fields.map(String) : [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  const cikIndex = fields.indexOf("cik");
  const nameIndex = fields.indexOf("name");
  const tickerIndex = fields.indexOf("ticker");
  const exchangeIndex = fields.indexOf("exchange");

  const match = data.find((row) => {
    if (!Array.isArray(row)) {
      return false;
    }
    return String(row[tickerIndex] ?? "").toUpperCase() === normalizedTicker;
  });

  if (!Array.isArray(match)) {
    throw new Error(`No SEC CIK mapping found for ${normalizedTicker}.`);
  }

  return {
    cik: padCik(match[cikIndex] as string | number),
    name: String(match[nameIndex] ?? normalizedTicker),
    ticker: normalizedTicker,
    exchange: exchangeIndex >= 0 ? String(match[exchangeIndex] ?? "") || null : null,
  };
}

export async function fetchLatest10K(cik: string): Promise<SecLatest10K> {
  const paddedCik = padCik(cik);
  const payload = await fetchSecJson<SecSubmissionsResponse>(`${SEC_DATA_BASE_URL}/submissions/CIK${paddedCik}.json`);
  const recent = payload.filings?.recent;
  if (!recent) {
    throw new Error(`No SEC submissions found for CIK ${paddedCik}.`);
  }

  const forms = readRecentColumn(recent, "form");
  const accessionNumbers = readRecentColumn(recent, "accessionNumber");
  const filingDates = readRecentColumn(recent, "filingDate");
  const reportDates = readRecentColumn(recent, "reportDate");
  const primaryDocuments = readRecentColumn(recent, "primaryDocument");
  const index = forms.findIndex((form) => form === "10-K");

  if (index < 0 || !accessionNumbers[index] || !primaryDocuments[index]) {
    throw new Error(`No latest 10-K found for CIK ${paddedCik}.`);
  }

  return {
    accessionNumber: accessionNumbers[index],
    filingDate: filingDates[index] || "",
    reportDate: reportDates[index] || null,
    primaryDocument: primaryDocuments[index],
    filingUrl: filingDocumentUrl(paddedCik, accessionNumbers[index], primaryDocuments[index]),
  };
}

export async function fetchLatest10KSections(cik: string, filing: SecLatest10K, signal?: AbortSignal): Promise<SecFilingSection[]> {
  const html = await fetchSecText(filing.filingUrl, signal);
  const anchoredSections = extractAnchoredSections(html);
  const text = htmlToText(html);
  const fallbackSections = [
    extractSection(text, "item1", "Item 1. Business"),
    extractSection(text, "item1a", "Item 1A. Risk Factors"),
  ];

  return [
    anchoredSections?.[0]?.text ? anchoredSections[0] : fallbackSections[0],
    anchoredSections?.[1]?.text ? anchoredSections[1] : fallbackSections[1],
  ];
}
