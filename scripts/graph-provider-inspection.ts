import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { findGraphBudgetTicket, GRAPH_BUDGET_MODEL, GRAPH_MAX_OUTPUT_TOKENS } from "../src/lib/company-graph/budget";
import { inspectCompanyGraphRequest } from "../src/lib/company-graph/inspection";

const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,100}$/.test(value) ? value : null;
/** GET one already-created response. This function has no generation, polling or settlement path. */
export async function inspectSavedGraphProviderResponse(db: Firestore, expectedRequestId: string,
  apiKey: string, fetchResponse: typeof fetch = fetch) {
  if (!/^graph_[a-f0-9]{64}$/.test(expectedRequestId) || !apiKey) throw new Error("An exact saved NVDA request and existing provider configuration are required");
  const inspection = await inspectCompanyGraphRequest(db, "NVDA");
  if (!inspection.request.identityMatches || inspection.request.requestId !== expectedRequestId
    || inspection.request.status !== "FAILED" || !inspection.request.force || !inspection.source?.identityMatches
    || !inspection.run?.identityMatches || !inspection.run.providerResponsePresent
    || !inspection.reservation?.requestKeyMatches || !inspection.reservation.matchesRunResponse) {
    throw new Error("The exact failed NVDA request lacks matching saved provider evidence; no API request was made");
  }
  const runId = inspection.run.runId;
  const ticket = await findGraphBudgetTicket(runId, db);
  const reservation = (await db.collection("company_research_runs").doc(`_graph_budget_request_${createHash("sha256").update(runId).digest("hex")}`).get()).data();
  const run = (await db.collection("company_research_runs").doc(`_graph_run_${runId}`).get()).data();
  if (!ticket?.responseId || ticket.responseId !== run?.providerResponseId || ticket.responseId !== reservation?.responseId
    || !["reserved", "settled"].includes(String(reservation?.status))) {
    throw new Error("Saved response identity changed; no API request was made");
  }
  const response = await fetchResponse(`https://api.openai.com/v1/responses/${encodeURIComponent(ticket.responseId)}`, {
    method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!response.ok) return { providerCalls: 1, method: "GET", httpStatus: response.status, metadataAvailable: false };
  const data = await response.json() as Record<string, unknown>;
  const usage = data?.usage as Record<string, unknown> | null;
  const inputTokens = integer(usage?.input_tokens), outputTokens = integer(usage?.output_tokens);
  const terminal = ["completed", "failed", "cancelled", "incomplete"].includes(String(data.status));
  const modelMatches = data.model === GRAPH_BUDGET_MODEL;
  const conservativeMicros = modelMatches && inputTokens !== null && outputTokens !== null ? inputTokens * 5 + outputTokens * 20 : null;
  // Never serialize the response body, its output, IDs, prompts, headers or error text.
  return { providerCalls: 1, method: "GET", httpStatus: response.status, metadataAvailable: true,
    model: label(data.model), status: label(data.status), serviceTier: label(data.service_tier),
    inputTokens, outputTokens, totalTokens: integer(usage?.total_tokens),
    reservedInputTokens: ticket.inputTokens, maximumOutputTokens: GRAPH_MAX_OUTPUT_TOKENS,
    reservedUsd: ticket.reservedMicros / 1e6, conservativeUsageUsd: conservativeMicros === null ? null : conservativeMicros / 1e6,
    checks: { responseIdMatches: data.id === ticket.responseId, modelMatches, terminal,
      usagePresent: Boolean(usage), inputWithinReservation: inputTokens !== null && inputTokens <= ticket.inputTokens,
      outputWithinLimit: outputTokens !== null && outputTokens <= GRAPH_MAX_OUTPUT_TOKENS,
      costWithinReservation: conservativeMicros !== null && conservativeMicros <= ticket.reservedMicros,
      reservationModelMatches: reservation?.model === GRAPH_BUDGET_MODEL,
      reservationPriceVersionMatches: reservation?.priceVersion === "gpt-5.6-sol-standard-2026-10-01" },
  };
}
