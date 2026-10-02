import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getGraphBudgetSummary } from "./budget";
import { companyGraphRequestId } from "./pubsub";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "./types";

/** Only a bounded message, never an error object, stack, or embedded provider body. */
export function redactGraphFailure(error: unknown): string {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "No saved error message";
  // JSON.parse can quote an entire provider body in a plain message, without a
  // leading object/array. Saved messages no longer retain the SyntaxError type.
  if (error instanceof SyntaxError || /\b(?:SyntaxError|JSON)\b/i.test(message)
    || /^(?:Unexpected token|Unexpected end|Expected |Unterminated |Bad control character|Bad escaped character|Invalid character)/i.test(message)) {
    return "Saved failure: JSON or syntax parsing failed; raw content withheld";
  }
  return message.split(/[\r\n]/, 1)[0]
    .replace(/[{\[].*$/, "[structured detail omitted]")
    .replace(/\b(?:prompt|input|output|text|input_text|output_text|body|payload|fingerprint)\s*[:=].*$/gi, "[detail omitted]")
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, "[URL REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, "$1 [REDACTED]")
    .replace(/((?:[?&]|\b)(?:[a-z][a-z0-9]*[_-])*(?:api[_ -]?key|api[_ -]?token|access[_ -]?token|refresh[_ -]?token|token|key|authorization|password|secret|credential)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&"']+)/gi, "$1[REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "[REDACTED]")
    .replace(/[A-Za-z0-9_+/=-]{32,}(?:\.[A-Za-z0-9_+/=-]+)*/g, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1000) || "No saved error message";
}

const COLLECTION = "company_research_runs";
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const date = (value: unknown) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) ? value : null;
const status = (value: unknown, allowed: string[]) => typeof value === "string" && allowed.includes(value) ? value : null;
const responsePresent = (value: unknown) => typeof value === "string" && value.length > 0;
const usd = (value: unknown) => { const micros = count(value); return micros === null ? null : micros / 1e6; };

/** Exact existing documents only; no scans, transactions, provider calls, or writes. */
export async function inspectCompanyGraphRequest(db: Firestore, ticker: string, now = Date.now()) {
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) throw new Error("One explicit US ticker is required");
  const [requestDoc, dailyBudget] = await Promise.all([
    db.collection("company_research_requests").doc(ticker).get(), getGraphBudgetSummary(db, now),
  ]);
  const saved = requestDoc.data();
  const generation = count(saved?.generation);
  const requestId = typeof saved?.requestId === "string" && /^graph_[a-f0-9]{64}$/.test(saved.requestId) ? saved.requestId : null;
  const identityMatches = Boolean(saved && saved.ticker === ticker && generation && requestId
    && requestId === companyGraphRequestId(ticker, generation) && typeof saved.force === "boolean"
    && saved.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION && date(saved.queuedAt));
  const request = {
    exists: Boolean(saved), ticker, identityMatches, requestId, generation,
    force: typeof saved?.force === "boolean" ? saved.force : null,
    status: status(saved?.status, ["QUEUED", "PROCESSING", "FAILED", "COMPLETED"]),
    error: saved?.error == null ? null : redactGraphFailure(saved.error),
    attemptCount: count(saved?.attemptCount), queuedAt: date(saved?.queuedAt),
    dispatchedAt: date(saved?.dispatchedAt), processingStartedAt: date(saved?.processingStartedAt),
    updatedAt: date(saved?.updatedAt), failedAt: date(saved?.failedAt), completedAt: date(saved?.completedAt),
    leaseExpiresAtMs: count(saved?.leaseExpiresAtMs), nextAttemptAtMs: count(saved?.nextAttemptAtMs),
    budgetDeferredUntilMs: count(saved?.budgetDeferredUntilMs),
  };
  if (!identityMatches) return { request, source: null, run: null, reservation: null, dailyBudget };
  const source = (await db.collection(COLLECTION).doc(`_graph_source_${requestId}`).get()).data();
  const accession = source?.filing?.accessionNumber;
  const sourceMatches = Boolean(source?.company?.ticker === ticker && /^\d{10}$/.test(source?.company?.cik ?? "")
    && typeof accession === "string" && /^\d{10}-\d{2}-\d{6}$/.test(accession));
  const sourceReport = { exists: Boolean(source), identityMatches: sourceMatches, accessionNumber: sourceMatches ? accession as string : null };
  if (!sourceMatches) return { request, source: sourceReport, run: null, reservation: null, dailyBudget };
  // Match the worker's frozen filing and forced/cached run identity, never the latest cache.
  const runId = `graph_${createHash("sha256").update(JSON.stringify([
    ticker, accession, COMPANY_GRAPH_EXTRACTION_VERSION, saved!.force ? requestId : "cached",
  ])).digest("hex")}`;
  const reservationId = `_graph_budget_request_${createHash("sha256").update(runId).digest("hex")}`;
  const [runDoc, reservationDoc] = await Promise.all([
    db.collection(COLLECTION).doc(`_graph_run_${runId}`).get(),
    db.collection(COLLECTION).doc(reservationId).get(),
  ]);
  const run = runDoc.data(), reservation = reservationDoc.data();
  return { request, source: sourceReport, dailyBudget,
    run: { runId, exists: Boolean(run),
      identityMatches: Boolean(run && run.ticker === ticker && run.accessionNumber === accession
        && run.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION),
      status: status(run?.status, ["PROCESSING", "PERSISTING", "PERSISTED"]), completed: run?.completed === true,
      createdAt: date(run?.createdAt), providerCompletedAt: date(run?.providerCompletedAt), completedAt: date(run?.completedAt),
      providerResponsePresent: responsePresent(run?.providerResponseId), providerResultPresent: run?.providerResult != null,
      durableResultPresent: run?.result != null,
      resultIdentityMatches: Boolean(run?.result?.runId === runId && run.result.ticker === ticker
        && run.result.filing?.accessionNumber === accession && run.result.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION),
    },
    reservation: { exists: Boolean(reservation), requestKeyMatches: reservation?.requestKey === runId,
      status: status(reservation?.status, ["reserved", "settled"]),
      reservedUsd: usd(reservation?.reservedMicros), spentUsd: usd(reservation?.spentMicros),
      createdAt: date(reservation?.createdAt), settledAt: date(reservation?.settledAt),
      providerResponsePresent: responsePresent(reservation?.responseId),
      matchesRunResponse: responsePresent(run?.providerResponseId) && run!.providerResponseId === reservation?.responseId,
    },
  };
}
