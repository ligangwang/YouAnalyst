import { createHash } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { validFundamentalsTicker } from "./service";

export const MAX_BATCH_COMPANIES = 20;
export type FundamentalsRequest = {
  version: 1; type: "fundamentals.refresh.requested"; batchId: string;
  companyIds: string[]; reason: "scheduled_or_manual" | "filing" | "verification"; requestedAt: string;
};
export type FundamentalsUpdate = {
  version: 1; type: "fundamentals.updated"; eventId: string; batchId: string;
  companyIds: string[]; versions: Record<string, string>;
};
export function parseFundamentalsRequest(value: unknown): FundamentalsRequest {
  const v = value as Partial<FundamentalsRequest> | null;
  if (!v || v.version !== 1 || v.type !== "fundamentals.refresh.requested"
    || typeof v.batchId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.batchId)
    || !Array.isArray(v.companyIds) || !v.companyIds.length || v.companyIds.length > MAX_BATCH_COMPANIES
    || !v.companyIds.every(t => typeof t === "string" && validFundamentalsTicker(t))
    || new Set(v.companyIds).size !== v.companyIds.length
    || !["scheduled_or_manual", "filing", "verification"].includes(String(v.reason))
    || typeof v.requestedAt !== "string" || !Number.isFinite(Date.parse(v.requestedAt))) {
    throw new Error("Invalid fundamentals batch request");
  }
  return { version: 1, type: "fundamentals.refresh.requested", batchId: v.batchId,
    companyIds: [...v.companyIds], reason: v.reason!, requestedAt: v.requestedAt };
}
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function fundamentalsVersion(value: Record<string, unknown> | null | undefined) {
  if (!value) return digest(null);
  const stable = { ...value };
  delete stable.fetchedAt;
  return digest(stable);
}
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/pubsub"] });
export async function publishFundamentalsMessage(topic: string, message: FundamentalsRequest | FundamentalsUpdate) {
  const project = process.env.GCP_PROJECT_ID;
  if (!project || !/^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(topic)) throw new Error("Pub/Sub project/topic missing or invalid");
  const client = await auth.getClient();
  const result = await client.request<{ messageIds: string[] }>({
    url: `https://pubsub.googleapis.com/v1/projects/${project}/topics/${topic}:publish`, method: "POST",
    data: { messages: [{ data: Buffer.from(JSON.stringify(message)).toString("base64"),
      attributes: { type: message.type, batchId: message.batchId } }] }, timeout: 20_000, retry: false,
  });
  if (!result.data.messageIds?.length) throw new Error("Pub/Sub publish was not confirmed");
  return result.data.messageIds[0];
}
