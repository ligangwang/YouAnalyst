import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase/admin";

export const GRAPH_BUDGET_TIMEZONE = "America/New_York" as const;
export const GRAPH_BUDGET_MODEL = "gpt-5.6-sol";
// The count endpoint is an application quality guard, never a billing bound.
export const GRAPH_MAX_INPUT_TOKENS = 100_000;
export const GRAPH_MAX_OUTPUT_TOKENS = 16_384;
export const GRAPH_MODEL_CONTEXT_TOKENS = 1_050_000;
export const GRAPH_PRICING_VALID_UNTIL = "2026-11-22T00:00:00.000Z";
export const GRAPH_LEGACY_PRICE_VERSION = "gpt-5.6-sol-standard-2026-10-01";
export const GRAPH_FLEX_PRICE_VERSION = "gpt-5.6-sol-flex-full-context-2026-10-02";
const FLEX_LONG_CONTEXT_THRESHOLD = 272_000;
// Reviewed Flex rates: short input/output 2/10, long input/output 4/15
// micro-USD/token. Explicit caching without breakpoints prevents cache writes.
// Reserve the entire model context at the highest input rate, plus all permitted
// output, independently of the preflight count (deliberately double-counting output).
export const GRAPH_FLEX_RESERVATION_MICROS = GRAPH_MODEL_CONTEXT_TOKENS * 4 + GRAPH_MAX_OUTPUT_TOKENS * 15;
const DEFAULT_LIMIT_MICROS = 5_000_000;
const COLLECTION = "company_research_runs";
const BUDGET_ID = "_graph_daily_budget";
const FLEX_POLICY = { expectedServiceTier: "flex", reasoningMode: "standard", promptCacheMode: "explicit",
  promptCacheBreakpoints: 0, maxContextTokens: GRAPH_MODEL_CONTEXT_TOKENS, maxOutputTokens: GRAPH_MAX_OUTPUT_TOKENS } as const;
const fail = (reason?: string): never => { throw new Error(`Graph budget cannot be verified${reason ? ` (${reason})` : ""}; paid processing is blocked.`); };
// Deployment opts in only after the full-context Flex policy has been reviewed.
export const isGraphPaidAdmissionEnabled = () => process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED === "1";
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
export class GraphBudgetExceededError extends Error {
  readonly retryAtMs: number;
  constructor(now = Date.now(), retryAtMs = nextGraphBudgetDay(now)) {
    super("Company graph budget cannot admit another full reservation; work is retained for a later retry.");
    this.name = "GraphBudgetExceededError"; this.retryAtMs = retryAtMs;
  }
}
export class GraphBudgetUncertainError extends Error {
  constructor() { super("A graph provider attempt has no durable response identity; its full budget reservation is retained for operator review."); this.name = "GraphBudgetUncertainError"; }
}
export type GraphBudgetSummary = {
  limitUsd: number; spentUsd: number; reservedUsd: number; remainingUsd: number; requestReservationUsd: number;
  day: string; timezone: typeof GRAPH_BUDGET_TIMEZONE; blocked: boolean; newRequestsPaused: boolean; pricingValidUntil: string;
};
type Budget = { day: string; limitMicros: number; spentMicros: number; reservedMicros: number };
export type GraphBudgetTicket = {
  id: string; requestKey: string; fingerprint: string; inputTokens: number; reservedMicros: number; responseId: string | null;
  ticketVersion: 1 | 2; priceVersion: typeof GRAPH_LEGACY_PRICE_VERSION | typeof GRAPH_FLEX_PRICE_VERSION;
};
function dayKey(now: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: GRAPH_BUDGET_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function nextGraphBudgetDay(now: number) {
  const day = dayKey(now);
  let low = now, high = now + 26 * 60 * 60_000;
  // DST days are 23/25 hours. Locate the actual next New York date boundary.
  while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (dayKey(middle) === day) low = middle; else high = middle; }
  return high;
}
function readBudget(raw: unknown, now: number): Budget {
  const day = dayKey(now);
  if (raw === undefined) return { day, limitMicros: DEFAULT_LIMIT_MICROS, spentMicros: 0, reservedMicros: 0 };
  const value = raw as Budget;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || value.day > day
    || ![value.limitMicros, value.spentMicros, value.reservedMicros, value.spentMicros + value.reservedMicros].every(integer)) return fail();
  // Unsettled reservations survive midnight, restarts, and unknown provider outcomes.
  return { ...value, day, spentMicros: value.day === day ? value.spentMicros : 0 };
}
function budgetRetryAt(value: Budget, now: number) {
  // A concurrent request may release most of its hold in minutes. Recheck rather
  // than postponing an otherwise affordable request until the next budget day.
  return value.reservedMicros > 0 && value.limitMicros - value.spentMicros >= GRAPH_FLEX_RESERVATION_MICROS
    ? Math.min(now + 60_000, nextGraphBudgetDay(now)) : nextGraphBudgetDay(now);
}
function summary(value: Budget, now: number): GraphBudgetSummary {
  const remaining = Math.max(0, value.limitMicros - value.spentMicros - value.reservedMicros);
  return { limitUsd: value.limitMicros / 1e6, spentUsd: value.spentMicros / 1e6,
    reservedUsd: value.reservedMicros / 1e6, remainingUsd: remaining / 1e6, requestReservationUsd: GRAPH_FLEX_RESERVATION_MICROS / 1e6, day: value.day,
    timezone: GRAPH_BUDGET_TIMEZONE, blocked: remaining < GRAPH_FLEX_RESERVATION_MICROS || now >= Date.parse(GRAPH_PRICING_VALID_UNTIL),
    newRequestsPaused: !isGraphPaidAdmissionEnabled(), pricingValidUntil: GRAPH_PRICING_VALID_UNTIL };
}
export async function getGraphBudgetSummary(db = getAdminFirestore(), now = Date.now()) {
  return summary(readBudget((await db.collection(COLLECTION).doc(BUDGET_ID).get()).data(), now), now);
}
export async function readCompanyGraphBudgetAvailability(db: Firestore, now = Date.now()) {
  const budget = readBudget((await db.collection(COLLECTION).doc(BUDGET_ID).get()).data(), now);
  const value = summary(budget, now);
  return { available: !value.blocked && !value.newRequestsPaused, retryAtMs: budgetRetryAt(budget, now) };
}
export async function setGraphBudgetLimit(limitUsd: number, db = getAdminFirestore(), now = Date.now()) {
  if (!Number.isFinite(limitUsd) || limitUsd < 0 || limitUsd > 1_000_000 || Math.abs(limitUsd * 100 - Math.round(limitUsd * 100)) > 1e-7) throw new Error("Budget must be a nonnegative USD amount with at most two decimal places.");
  const ref = db.collection(COLLECTION).doc(BUDGET_ID);
  return db.runTransaction(async tx => {
    const value = readBudget((await tx.get(ref)).data(), now);
    value.limitMicros = Math.round(limitUsd * 1e6);
    tx.set(ref, { ...value, timezone: GRAPH_BUDGET_TIMEZONE, updatedAt: new Date(now).toISOString() }, { merge: true });
    return summary(value, now);
  });
}
export function graphReservationMicros(model: string, inputTokens: number, now = Date.now()) {
  if (model !== GRAPH_BUDGET_MODEL || now >= Date.parse(GRAPH_PRICING_VALID_UNTIL)
    || !integer(inputTokens) || inputTokens === 0 || inputTokens > GRAPH_MAX_INPUT_TOKENS) return fail();
  return GRAPH_FLEX_RESERVATION_MICROS;
}
export function graphBudgetFingerprint(body: unknown) { return createHash("sha256").update(JSON.stringify(body)).digest("hex"); }
function ticketId(requestKey: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(requestKey)) return fail();
  return `_graph_budget_request_${createHash("sha256").update(requestKey).digest("hex")}`;
}
function readTicket(value: Record<string, unknown>, requestKey: string): GraphBudgetTicket {
  if (value.requestKey !== requestKey || typeof value.fingerprint !== "string" || !value.fingerprint
    || !integer(value.inputTokens) || value.inputTokens === 0 || value.inputTokens > GRAPH_MAX_INPUT_TOKENS
    || !integer(value.reservedMicros) || value.model !== GRAPH_BUDGET_MODEL
    || (value.responseId !== null && (typeof value.responseId !== "string" || !/^resp_[A-Za-z0-9_-]+$/.test(value.responseId)))) return fail("ticket metadata");
  let ticketVersion: 1 | 2;
  if (value.priceVersion === GRAPH_LEGACY_PRICE_VERSION && (value.ticketVersion === undefined || value.ticketVersion === 1)
    && value.reservedMicros === value.inputTokens * 5 + GRAPH_MAX_OUTPUT_TOKENS * 20) ticketVersion = 1;
  else if (value.priceVersion === GRAPH_FLEX_PRICE_VERSION && value.ticketVersion === 2
    && value.reservedMicros === GRAPH_FLEX_RESERVATION_MICROS
    && Object.entries(FLEX_POLICY).every(([key, expected]) => value[key] === expected)) ticketVersion = 2;
  else return fail("unreviewed ticket pricing or policy");
  return { id: ticketId(requestKey), requestKey, fingerprint: value.fingerprint, inputTokens: value.inputTokens,
    reservedMicros: value.reservedMicros, responseId: value.responseId as string | null, ticketVersion,
    priceVersion: value.priceVersion as GraphBudgetTicket["priceVersion"] };
}
export async function findGraphBudgetTicket(requestKey: string, db: Firestore): Promise<GraphBudgetTicket | null> {
  const value = (await db.collection(COLLECTION).doc(ticketId(requestKey)).get()).data();
  return value ? readTicket(value, requestKey) : null;
}
export async function reserveGraphBudget(input: { requestKey: string; fingerprint: string; model: string; inputTokens: number }, db: Firestore, now = Date.now()): Promise<GraphBudgetTicket> {
  const reservedMicros = graphReservationMicros(input.model, input.inputTokens, now), id = ticketId(input.requestKey);
  if (!input.fingerprint) return fail("request fingerprint");
  const budgetRef = db.collection(COLLECTION).doc(BUDGET_ID), requestRef = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async tx => {
    const [budgetDoc, requestDoc] = await Promise.all([tx.get(budgetRef), tx.get(requestRef)]);
    const prior = requestDoc.data();
    if (prior) {
      if (prior.fingerprint !== input.fingerprint || prior.requestKey !== input.requestKey) return fail();
      // Only the creator of a new reservation may POST. No response-less retry:
      // the first attempt may already have incurred a charge.
      throw new GraphBudgetUncertainError();
    }
    const budget = readBudget(budgetDoc.data(), now);
    if (reservedMicros > budget.limitMicros - budget.spentMicros - budget.reservedMicros) throw new GraphBudgetExceededError(now, budgetRetryAt(budget, now));
    budget.reservedMicros += reservedMicros;
    const ticket: GraphBudgetTicket = { id, requestKey: input.requestKey, fingerprint: input.fingerprint, inputTokens: input.inputTokens,
      reservedMicros, responseId: null, ticketVersion: 2, priceVersion: GRAPH_FLEX_PRICE_VERSION };
    tx.set(budgetRef, { ...budget, timezone: GRAPH_BUDGET_TIMEZONE }, { merge: true });
    tx.set(requestRef, { ...ticket, ...FLEX_POLICY, model: input.model, status: "reserved", createdAt: new Date(now).toISOString() });
    return ticket;
  });
}
async function checkTicket(tx: Transaction, ticket: GraphBudgetTicket, db: Firestore) {
  const ref = db.collection(COLLECTION).doc(ticket.id), value = (await tx.get(ref)).data();
  if (!value) return fail("missing ticket");
  const stored = readTicket(value, ticket.requestKey);
  if (stored.id !== ticket.id || stored.fingerprint !== ticket.fingerprint || stored.reservedMicros !== ticket.reservedMicros
    || stored.inputTokens !== ticket.inputTokens || stored.ticketVersion !== ticket.ticketVersion || stored.priceVersion !== ticket.priceVersion) return fail("ticket changed");
  return { ref, value };
}
export async function recordGraphResponse(ticket: GraphBudgetTicket, responseId: string, db: Firestore) {
  if (!/^resp_[A-Za-z0-9_-]+$/.test(responseId)) return fail();
  await db.runTransaction(async tx => {
    const { ref, value } = await checkTicket(tx, ticket, db);
    if (value.responseId && value.responseId !== responseId) return fail();
    tx.set(ref, { responseId }, { merge: true });
  });
}
/** Release unused reservation only after terminal usage and the pricing policy are verified. */
export async function settleGraphBudget(ticket: GraphBudgetTicket, response: Record<string, unknown>, db: Firestore, now = Date.now()) {
  const usage = record(response.usage), flex = ticket.ticketVersion === 2;
  if (!ticket.responseId || response.id !== ticket.responseId) return fail("response identity");
  if (response.model !== GRAPH_BUDGET_MODEL || response.service_tier !== (flex ? "flex" : "default")) return fail("unreviewed model or pricing tier");
  if (!["completed", "failed", "cancelled", "incomplete"].includes(String(response.status))) return fail("response is not terminal");
  if (!usage || !integer(usage.input_tokens) || usage.input_tokens > (flex ? GRAPH_MODEL_CONTEXT_TOKENS : GRAPH_MAX_INPUT_TOKENS)
    || !integer(usage.output_tokens) || usage.output_tokens > GRAPH_MAX_OUTPUT_TOKENS) return fail("unverified token usage");
  const inputTokens = usage.input_tokens, outputTokens = usage.output_tokens;
  const audit: Record<string, unknown> = {};
  if (flex) {
    const details = record(usage.input_tokens_details), reasoning = record(response.reasoning), caching = record(response.prompt_cache_options);
    if (reasoning?.mode !== "standard" || caching?.mode !== "explicit"
      || details?.cache_write_tokens !== 0 || details?.cached_tokens !== 0) return fail("unverified reasoning or cache policy");
    if (!integer(usage.total_tokens) || usage.total_tokens !== inputTokens + outputTokens || usage.total_tokens > GRAPH_MODEL_CONTEXT_TOKENS) return fail("unverified context usage");
    const outputDetails = record(usage.output_tokens_details);
    if (outputDetails && (!integer(outputDetails.reasoning_tokens) || outputDetails.reasoning_tokens > outputTokens)) return fail("unverified reasoning usage");
    if (response.tools !== undefined && (!Array.isArray(response.tools) || response.tools.length !== 0)) return fail("unexpected tool charges");
    Object.assign(audit, { serviceTier: "flex", reasoningMode: "standard", promptCacheMode: "explicit", cacheWriteTokens: 0, cachedTokens: 0 });
  }
  // Preserve the reviewed legacy Standard settlement for existing saved responses,
  // including NVDA's 11,133 preflight / 11,138 actual input-token discrepancy.
  const longContext = inputTokens > FLEX_LONG_CONTEXT_THRESHOLD;
  const spentMicros = flex ? inputTokens * (longContext ? 4 : 2) + outputTokens * (longContext ? 15 : 10)
    : inputTokens * 5 + outputTokens * 20;
  if (!Number.isSafeInteger(spentMicros) || spentMicros > ticket.reservedMicros) return fail("actual cost exceeds reservation");
  const budgetRef = db.collection(COLLECTION).doc(BUDGET_ID);
  await db.runTransaction(async tx => {
    const { ref, value } = await checkTicket(tx, ticket, db);
    const budget = readBudget((await tx.get(budgetRef)).data(), now);
    if (value.responseId !== ticket.responseId) return fail("stored response identity");
    if (value.status === "settled") {
      if (value.spentMicros !== spentMicros || value.usageInputTokens !== inputTokens || value.usageOutputTokens !== outputTokens
        || Object.entries(audit).some(([key, expected]) => value[key] !== expected)) return fail("settled usage changed");
      return;
    }
    if (value.status !== "reserved" || budget.reservedMicros < ticket.reservedMicros) return fail("reservation liability");
    budget.reservedMicros -= ticket.reservedMicros;
    budget.spentMicros += spentMicros;
    if (!integer(budget.spentMicros)) return fail("budget overflow");
    tx.set(budgetRef, budget, { merge: true });
    tx.set(ref, { status: "settled", spentMicros, usageInputTokens: inputTokens, usageOutputTokens: outputTokens, ...audit,
      inputTokenDelta: inputTokens - ticket.inputTokens, settledDay: budget.day, settledAt: new Date(now).toISOString() }, { merge: true });
  });
}
