import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Firestore } from "firebase-admin/firestore";
import { secRequest } from "../sec-request";
import { secCooldownMs } from "../sec-budget";
import { validateSource } from "./document";
import { earningsMetadata } from "./live-store";
import { validateSourceUrl } from "./issuers";
import type { EarningsSource, RawEarningsDocument } from "./model";

export const MAX_EARNINGS_DOCUMENT_BYTES = 20 * 1024 * 1024;
export async function readBoundedEarningsBody(response: Response, maxBytes = MAX_EARNINGS_DOCUMENT_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_EARNINGS_DOCUMENT_BYTES) throw new Error("Invalid document byte budget");
  if (!response.body || Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new Error("Earnings response exceeds byte limit or has no body"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maxBytes) throw new Error("Earnings response exceeds byte limit");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (!size) throw new Error("Empty earnings response");
  return Buffer.concat(chunks);
}
/** Shared across earnings discovery/worker replicas. The separate legacy CN
 * fundamentals requester still has its own local limit; this is not a claim of
 * a provider-wide account quota. No provider credentials are used. */
export function createEarningsRequestGate(db: Firestore, options: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  const now = options.now ?? Date.now, sleep = options.sleep ?? (ms => delay(ms));
  const provider = (host: string) => {
    if (!["www.cninfo.com.cn", "static.cninfo.com.cn", "dataclouds.cninfo.com.cn"].includes(host)) throw new Error("Unsupported earnings request host");
    return earningsMetadata(db, "provider_cninfo");
  };
  return {
    async beforeRequest({ host }: { host: string }) {
      const ref = provider(host), deadline = now() + 15_000;
      for (;;) {
        if (now() > deadline) throw new Error("Earnings provider request budget timed out");
        const wait = await db.runTransaction(async tx => {
          const snapshot = await tx.get(ref), time = snapshot.readTime?.toMillis() ?? now(), value = snapshot.data();
          if (Number(value?.cooldownUntilMs) > time) throw Object.assign(new Error("CNINFO earnings cooldown is active"), { code: 429 });
          const remaining = Number(value?.nextAllowedAtMs ?? 0) - time;
          if (remaining > 0) return Math.min(remaining, 500);
          tx.set(ref, { nextAllowedAtMs: time + 1000 }, { merge: true }); return 0;
        });
        if (!wait) return; await sleep(wait);
      }
    },
    async onBlocked({ host, code, retryAfter }: { host: string; code: string | number; retryAfter: string | null }) {
      const ref = provider(host);
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref), time = snapshot.readTime?.toMillis() ?? now();
        const wait = typeof code === "number" ? secCooldownMs(code, retryAfter, time) : 60_000;
        tx.set(ref, { cooldownUntilMs: Math.max(Number(snapshot.get("cooldownUntilMs")) || 0, time + Math.max(wait, 60_000)), lastCode: String(code).slice(0, 100) }, { merge: true });
      });
    },
  };
}
export type EarningsDownload = { bytes: Uint8Array; mediaType: RawEarningsDocument["mediaType"]; pdfText?: string };
export function createEarningsDownloader(db: Firestore, options: { userAgent: string; signal?: AbortSignal; fetcher?: typeof fetch } ) {
  if (!options.userAgent.trim()) throw new Error("SEC_USER_AGENT is required for the earnings pilot");
  const gate = createEarningsRequestGate(db), fetcher = options.fetcher ?? fetch;
  return async (source: EarningsSource): Promise<EarningsDownload> => {
    validateSource(source); validateSourceUrl(source.companyId, source.url, source.provider);
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
    const decode = async (response: Response) => {
      if (response.redirected || (response.url && response.url !== source.url)) throw new Error("Unexpected earnings source redirect");
      const bytes = await readBoundedEarningsBody(response);
      const type = response.headers.get("content-type") ?? "";
      const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
      const mediaType: RawEarningsDocument["mediaType"] = pdf ? "application/pdf" : /text\/html|application\/xhtml/i.test(type) ? "text/html" : "text/plain";
      if (!pdf && /\.pdf(?:\?|$)/i.test(source.url)) throw new Error("PDF endpoint returned a non-PDF document");
      let pdfText: string | undefined;
      if (pdf) {
        const directory = await mkdtemp(join(tmpdir(), "youanalyst-earnings-"));
        try {
          const path = join(directory, "source.pdf"); await writeFile(path, bytes);
          pdfText = (await promisify(execFile)("pdftotext", ["-layout", path, "-"], { timeout: 20_000, maxBuffer: MAX_EARNINGS_DOCUMENT_BYTES })).stdout;
        } finally { await rm(directory, { recursive: true, force: true }); }
      }
      return { bytes, mediaType, ...(pdfText ? { pdfText } : {}) };
    };
    if (source.provider === "sec") return secRequest(source.url, { signal, headers: { "user-agent": options.userAgent, accept: "text/html,application/pdf,text/plain" } }, decode,
      { cik: source.issuerId.slice(4), accession: source.accession, operation: "earnings_document" });
    if (source.provider !== "cninfo") throw new Error("Live issuer-IR discovery is not enabled; use the reviewed SEC/CNINFO source paths");
    const host = new URL(source.url).hostname;
    await gate.beforeRequest({ host });
    try {
      const response = await fetcher(source.url, { signal, redirect: "error", credentials: "omit", headers: { "user-agent": "YouAnalyst/1.0 (earnings pilot)", accept: "application/pdf" } });
      if (!response.ok) {
        await response.body?.cancel();
        if ([403, 429].includes(response.status)) await gate.onBlocked({ host, code: response.status, retryAfter: response.headers.get("retry-after") });
        throw Object.assign(new Error(`CNINFO document request failed (${response.status})`), { code: response.status });
      }
      return await decode(response);
    } catch (error) {
      if (!(error as { code?: unknown })?.code) await gate.onBlocked({ host, code: "NETWORK_OR_DECODE", retryAfter: null });
      throw error;
    }
  };
}
