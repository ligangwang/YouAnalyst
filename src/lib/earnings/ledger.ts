import { type EarningsRecord, sha256, canonicalJson } from "./model";

export type EarningsReplayState = { version: 1; records: Record<string, EarningsRecord>; outbox: Record<string, { revisionId: string; acknowledged: boolean }> };
export const emptyEarningsReplayState = (): EarningsReplayState => ({ version: 1, records: {}, outbox: {} });
function samePeriod(a: EarningsRecord, b: EarningsRecord) {
  return a.issuerId === b.issuerId && canonicalJson(a.period) === canonicalJson(b.period) && a.kind === b.kind;
}
// Local replay only. A future production store must atomically commit the record
// and outbox in one transaction before acknowledging its input delivery.
export function stageEarningsRecord(state: EarningsReplayState, record: EarningsRecord) {
  if (state.version !== 1) throw new Error("Unknown earnings ledger version");
  const existing = state.records[record.revisionId];
  if (existing) {
    const content = (value: EarningsRecord) => canonicalJson({ ...value, extractedAt: undefined, source: { ...value.source, firstSeenAt: undefined } });
    if (content(existing) !== content(record)) throw new Error("Conflicting content for the same earnings revision");
    return { status: "duplicate" as const, state };
  }
  if (record.supersedes) {
    const prior = Object.values(state.records).filter(value => value.eventId === record.supersedes);
    if (!prior.length) return { status: "predecessor_missing" as const, state };
    if (prior.some(value => !samePeriod(record, value))) throw new Error("Correction issuer, period or kind mismatch");
    const pending = [record.supersedes], visited = new Set<string>();
    while (pending.length) {
      const event = pending.pop()!;
      if (event === record.eventId) throw new Error("Correction cycle");
      if (visited.has(event)) continue;
      visited.add(event);
      for (const ancestor of Object.values(state.records).filter(value => value.eventId === event)) if (ancestor.supersedes) pending.push(ancestor.supersedes);
    }
    const published = record.source.publishedAt;
    for (const ancestor of prior) {
      const previous = ancestor.source.publishedAt;
      if (!published || !previous) continue;
      const earlier = published.precision === "second" && previous.precision === "second"
        ? Date.parse(published.value) < Date.parse(previous.value)
        : published.precision === "date" && previous.precision === "date" && published.timezone === previous.timezone && published.value < previous.value;
      if (earlier) throw new Error("Correction predates original");
    }
  }
  const next: EarningsReplayState = { version: 1, records: { ...state.records, [record.revisionId]: record },
    outbox: { ...state.outbox, [record.revisionId]: { revisionId: record.revisionId, acknowledged: false } } };
  return { status: "staged" as const, state: next };
}
export async function drainEarningsOutbox(state: EarningsReplayState, publish: (record: EarningsRecord) => Promise<void>) {
  const next = structuredClone(state);
  for (const item of Object.values(next.outbox).filter(item => !item.acknowledged)) {
    const record = next.records[item.revisionId];
    if (!record) throw new Error("Outbox refers to absent earnings record");
    await publish(record); // Failed publication leaves original state pending.
    item.acknowledged = true;
  }
  return next;
}
export function earningsContentFingerprint(record: EarningsRecord) {
  // For duplicate-review suggestions across mirrors only, never automatic issuer,
  // correction or forecast merging. Raw sources and version history stay intact.
  return sha256(canonicalJson([record.issuerId, record.kind, record.period, record.metrics.map(metric => ({ name: metric.name, scope: metric.scope, segment: metric.segment, value: metric.value, low: metric.low, high: metric.high, currency: metric.currency, unit: metric.unit, period: metric.period, kind: metric.kind, basis: metric.basis }))]));
}
