import { stableId, validTimestamp } from "./model";

export const EARNINGS_TOPIC = "earnings-sources-discovered";
export const EARNINGS_SUBSCRIPTION = "earnings-worker";
export type EarningsSourceDiscovered = { version: 1; type: "earnings.source.discovered"; eventId: string; batchId: string; sourceId: string; generation: number };
export type EarningsDeliveryProbe = { version: 1; type: "earnings.delivery.probe"; batchId: string; createdAt: string };
export type EarningsJob = EarningsSourceDiscovered | EarningsDeliveryProbe;

export function earningsSourceEvent(sourceId: string, generation: number): EarningsSourceDiscovered {
  if (!/^earnings_source_[a-f0-9]{64}$/.test(sourceId) || !Number.isSafeInteger(generation) || generation < 1 || generation > 1_000_000) throw new Error("Invalid earnings source delivery identity");
  const eventId = stableId("earnings_delivery", [sourceId, generation]);
  return { version: 1, type: "earnings.source.discovered", eventId, batchId: eventId, sourceId, generation };
}
export function parseEarningsJob(value: unknown): EarningsJob {
  if (!value || typeof value !== "object") throw new Error("Invalid earnings event");
  const v = value as Record<string, unknown>;
  if (v.version !== 1) throw new Error("Unknown earnings event version");
  if (v.type === "earnings.source.discovered") {
    if (Object.keys(v).some(k => !["version", "type", "eventId", "batchId", "sourceId", "generation"].includes(k))) throw new Error("Unexpected earnings source event field");
    const event = earningsSourceEvent(String(v.sourceId), Number(v.generation));
    if (v.generation !== event.generation || v.eventId !== event.eventId || v.batchId !== event.batchId) throw new Error("Earnings event identity mismatch");
    return event;
  }
  if (v.type === "earnings.delivery.probe" && Object.keys(v).every(k => ["version", "type", "batchId", "createdAt"].includes(k))
    && typeof v.batchId === "string" && /^earnings_probe_[a-f0-9]{32}$/.test(v.batchId) && validTimestamp(v.createdAt)) {
    return { version: 1, type: v.type, batchId: v.batchId, createdAt: v.createdAt };
  }
  throw new Error("Unsupported earnings event type");
}
