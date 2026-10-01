import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase/admin";

// Conservative upper rates, including cache writes. Standard text-only requests,
// no tools, <=100K input tokens; reject future/unknown pricing instead of guessing.
export const GRAPH_BUDGET_TIMEZONE = "America/New_York" as const;
export const GRAPH_BUDGET_MODEL = "gpt-5.6-sol";
export const GRAPH_MAX_INPUT_TOKENS = 100_000;
export const GRAPH_MAX_OUTPUT_TOKENS = 16_384;
export const GRAPH_PRICING_VALID_UNTIL = "2026-11-22T00:00:00.000Z";
const PRICE_VERSION = "gpt-5.6-sol-standard-2026-10-01";
const INPUT_MICROS_PER_TOKEN = 5;
const OUTPUT_MICROS_PER_TOKEN = 20;
const DEFAULT_LIMIT_MICROS = 5_000_000;
const COLLECTION = "company_research_runs";
const BUDGET_ID = "_graph_daily_budget";
const fail = () => { throw new Error("Graph budget cannot be verified; paid processing is blocked."); };
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export class GraphBudgetExceededError extends Error {
  readonly retryAtMs: number;
  constructor(now = Date.now()) { super("Company graph daily budget is exhausted; work is retained for the next budget day."); this.name = "GraphBudgetExceededError"; this.retryAtMs = nextGraphBudgetDay(now); }
}
export class GraphBudgetUncertainError extends Error {
  constructor() { super("A graph provider attempt has no durable response identity; its full budget reservation is retained for operator review."); this.name = "GraphBudgetUncertainError"; }
}
export type GraphBudgetSummary = {
  limitUsd: number; spentUsd: number; reservedUsd: number; remainingUsd: number;
  day: string; timezone: typeof GRAPH_BUDGET_TIMEZONE; blocked: boolean; pricingValidUntil: string;
};
type Budget = { day: string; limitMicros: number; spentMicros: number; reservedMicros: number };
export type GraphBudgetTicket = { id: string; requestKey: string; fingerprint: string; inputTokens: number; reservedMicros: number; responseId: string | null };
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
    || ![value.limitMicros, value.spentMicros, value.reservedMicros].every(integer)) return fail();
  // Unsettled reservations survive midnight, restarts, and unknown provider outcomes.
  return { ...value, day, spentMicros: value.day === day ? value.spentMicros : 0 };
}
function summary(value: Budget, now: number): GraphBudgetSummary {
  const remaining = Math.max(0, value.limitMicros - value.spentMicros - value.reservedMicros);
  return { limitUsd: value.limitMicros / 1e6, spentUsd: value.spentMicros / 1e6,
    reservedUsd: value.reservedMicros / 1e6, remainingUsd: remaining / 1e6, day: value.day,
    timezone: GRAPH_BUDGET_TIMEZONE, blocked: remaining < GRAPH_MAX_OUTPUT_TOKENS * OUTPUT_MICROS_PER_TOKEN + INPUT_MICROS_PER_TOKEN
      || now >= Date.parse(GRAPH_PRICING_VALID_UNTIL),
    pricingValidUntil: GRAPH_PRICING_VALID_UNTIL };
}
export async function getGraphBudgetSummary(db = getAdminFirestore(), now = Date.now()) {
  return summary(readBudget((await db.collection(COLLECTION).doc(BUDGET_ID).get()).data(), now), now);
}
export async function readCompanyGraphBudgetAvailability(db: Firestore, now = Date.now()) {
  const value = await getGraphBudgetSummary(db, now);
  return { available: !value.blocked && Math.round(value.remainingUsd * 1e6) >= GRAPH_MAX_OUTPUT_TOKENS * OUTPUT_MICROS_PER_TOKEN + INPUT_MICROS_PER_TOKEN,
    retryAtMs: nextGraphBudgetDay(now) };
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
  return inputTokens * INPUT_MICROS_PER_TOKEN + GRAPH_MAX_OUTPUT_TOKENS * OUTPUT_MICROS_PER_TOKEN;
}
export function graphBudgetFingerprint(body: unknown) { return createHash("sha256").update(JSON.stringify(body)).digest("hex"); }
function ticketId(requestKey: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(requestKey)) return fail();
  return `_graph_budget_request_${createHash("sha256").update(requestKey).digest("hex")}`;
}
export async function findGraphBudgetTicket(requestKey: string, db: Firestore): Promise<GraphBudgetTicket | null> {
  const id = ticketId(requestKey), value = (await db.collection(COLLECTION).doc(id).get()).data();
  if (!value) return null;
  if (value.requestKey !== requestKey || typeof value.fingerprint !== "string" || !integer(value.inputTokens)
    || !integer(value.reservedMicros) || (value.responseId !== null && !/^resp_[A-Za-z0-9_-]+$/.test(value.responseId))) return fail();
  return { id, requestKey, fingerprint: value.fingerprint, inputTokens: value.inputTokens,
    reservedMicros: value.reservedMicros, responseId: value.responseId };
}
export async function reserveGraphBudget(input: { requestKey: string; fingerprint: string; model: string; inputTokens: number }, db: Firestore, now = Date.now()): Promise<GraphBudgetTicket> {
  const reservedMicros = graphReservationMicros(input.model, input.inputTokens, now), id = ticketId(input.requestKey);
  const budgetRef = db.collection(COLLECTION).doc(BUDGET_ID), requestRef = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async tx => {
    const [budgetDoc, requestDoc] = await Promise.all([tx.get(budgetRef), tx.get(requestRef)]);
    const prior = requestDoc.data();
    if (prior) {
      if (prior.fingerprint !== input.fingerprint || prior.requestKey !== input.requestKey) return fail();
      // Only the creator of a new reservation may POST. A response-less existing
      // reservation might already have incurred a charge; never automatically retry.
      throw new GraphBudgetUncertainError();
    }
    const budget = readBudget(budgetDoc.data(), now);
    if (budget.spentMicros + budget.reservedMicros + reservedMicros > budget.limitMicros) throw new GraphBudgetExceededError(now);
    budget.reservedMicros += reservedMicros;
    const ticket = { id, requestKey: input.requestKey, fingerprint: input.fingerprint, inputTokens: input.inputTokens, reservedMicros, responseId: null };
    tx.set(budgetRef, { ...budget, timezone: GRAPH_BUDGET_TIMEZONE }, { merge: true });
    tx.set(requestRef, { ...ticket, model: input.model, priceVersion: PRICE_VERSION, status: "reserved", createdAt: new Date(now).toISOString() });
    return ticket;
  });
}
async function checkTicket(tx: Transaction, ticket: GraphBudgetTicket, db: Firestore) {
  const ref = db.collection(COLLECTION).doc(ticket.id), value = (await tx.get(ref)).data();
  if (!value || value.requestKey !== ticket.requestKey || value.fingerprint !== ticket.fingerprint
    || value.reservedMicros !== ticket.reservedMicros || value.priceVersion !== PRICE_VERSION) return fail();
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
/** Release unused reservation only after terminal usage is complete and bounded. */
export async function settleGraphBudget(ticket: GraphBudgetTicket, response: Record<string, unknown>, db: Firestore, now = Date.now()) {
  const usage = response.usage as Record<string, unknown> | null;
  if (!ticket.responseId || response.id !== ticket.responseId || response.model !== GRAPH_BUDGET_MODEL
    || !["completed", "failed", "cancelled", "incomplete"].includes(String(response.status))
    || !usage || !integer(usage.input_tokens) || usage.input_tokens > ticket.inputTokens
    || !integer(usage.output_tokens) || usage.output_tokens > GRAPH_MAX_OUTPUT_TOKENS) return fail();
  const spentMicros = usage.input_tokens * INPUT_MICROS_PER_TOKEN + usage.output_tokens * OUTPUT_MICROS_PER_TOKEN;
  if (spentMicros > ticket.reservedMicros) return fail();
  const budgetRef = db.collection(COLLECTION).doc(BUDGET_ID);
  await db.runTransaction(async tx => {
    const { ref, value } = await checkTicket(tx, ticket, db);
    const budget = readBudget((await tx.get(budgetRef)).data(), now);
    if (value.status === "settled") return;
    if (value.responseId !== ticket.responseId || budget.reservedMicros < ticket.reservedMicros) return fail();
    budget.reservedMicros -= ticket.reservedMicros;
    budget.spentMicros += spentMicros;
    tx.set(budgetRef, budget, { merge: true });
    tx.set(ref, { status: "settled", spentMicros, settledDay: budget.day, settledAt: new Date(now).toISOString() }, { merge: true });
  });
}
