import { type EarningsSource, type RawEarningsDocument, sha256, sourceIdentity, validDate, validTimestamp } from "./model";
import { pilotCompany, validateSourceUrl } from "./pilot";

const MAX_BYTES = 20 * 1024 * 1024;
export function htmlToEarningsText(html: string) {
  return html.replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|ix:hidden|ix:header)\b[^>]*>[^]*?<\/\1>/gi, " ")
    .replace(/<tr\b[^>]*>([^]*?)<\/tr>/gi, (_row, body: string) => {
      const cells = [...body.matchAll(/<t[dh]\b[^>]*>([^]*?)<\/t[dh]>/gi)]
        .map(cell => cell[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
      return cells.length ? `\n${cells.join(" | ")} |\n` : body;
    })
    .replace(/<\/(?:td|th)>/gi, " | ").replace(/<\/(?:p|div|section|article|tr|table|h[1-6]|li)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex: string, dec: string) => { const n = parseInt(hex || dec, hex ? 16 : 10); return n <= 0x10ffff ? String.fromCodePoint(n) : " "; })
    .replace(/[\t\r ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function validateSource(source: EarningsSource) {
  const company = pilotCompany(source.companyId);
  if (!["sec", "cninfo", "issuer_ir"].includes(source.provider) || !["en", "zh"].includes(source.language)) throw new Error("Invalid source provider or language");
  if (source.issuerId !== company.issuerId || !source.documentId || source.documentId.length > 500 || !source.title || source.title.length > 1000) throw new Error("Invalid earnings source identity");
  validateSourceUrl(source.companyId, source.url, source.provider);
  if (!validTimestamp(source.firstSeenAt)) throw new Error("Invalid first-seen timestamp");
  if (source.publishedAt) {
    const time = source.publishedAt;
    if (time.precision === "date" ? !validDate(time.value) : time.precision !== "second" || !validTimestamp(time.value)) throw new Error("Invalid source publication time");
    if (time.precision === "date" && time.timezone === "UTC") throw new Error("Do not manufacture a UTC instant from a source date");
  }
  if (source.filingAcceptedAt && !validTimestamp(source.filingAcceptedAt)) throw new Error("Invalid filing acceptance timestamp");
  if (source.correctionOf !== undefined && (typeof source.correctionOf !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(source.correctionOf))) throw new Error("Invalid correction predecessor");
  if (source.filingDate && !validDate(source.filingDate)) throw new Error("Invalid filing date");
}
export function captureEarningsDocument(source: EarningsSource, bytes: Uint8Array, options: {
  mediaType: RawEarningsDocument["mediaType"]; retrievedAt: string;
  pdfText?: string; completeness?: "full" | "excerpt";
}): RawEarningsDocument {
  validateSource(source);
  if (!bytes.length || bytes.length > MAX_BYTES || !validTimestamp(options.retrievedAt)) throw new Error("Invalid raw earnings capture");
  const decoded = new TextDecoder("utf-8", { fatal: options.mediaType !== "application/pdf" });
  let text: string;
  if (options.mediaType === "application/pdf") {
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") throw new Error("Document is not a PDF");
    if (!options.pdfText?.trim()) throw new Error("PDF text unavailable: provide pdftotext-layout output; OCR is unsupported");
    text = options.pdfText.replace(/\r/g, "").trim();
  } else {
    const body = decoded.decode(bytes);
    if (/^\s*(?:<!doctype html|<html)/i.test(body) && options.mediaType === "text/plain") throw new Error("HTML returned for plain-text capture");
    text = options.mediaType === "text/html" ? htmlToEarningsText(body) : body.trim();
  }
  if (!text || text.length > MAX_BYTES || /captcha|access denied|request (?:has been )?blocked/i.test(text.slice(0, 500))) throw new Error("Unavailable or blocked document");
  return { source, sourceId: sourceIdentity(source), rawSha256: sha256(bytes), textSha256: sha256(text), text,
    mediaType: options.mediaType, retrievedAt: options.retrievedAt,
    textMethod: options.mediaType === "application/pdf" ? "pdftotext-layout" : options.mediaType === "text/html" ? "html" : "plain",
    completeness: options.completeness ?? "full" };
}
