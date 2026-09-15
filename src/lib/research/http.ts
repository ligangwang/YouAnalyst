import { AssertionError } from "node:assert";
import { getAdminFirestore } from "../firebase/admin";
import { authenticatePublisher, ResearchError } from "./auth";
import { previewBatch, publishBatch, getBatch } from "./batches";
const MAX_BODY = 180_000;
const requests = new Map<string, { start: number; count: number }>();
export async function readResearchJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ResearchError(415, "Use application/json");
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new ResearchError(413, "Request too large");
  const reader = request.body?.getReader(); if (!reader) throw new ResearchError(400, "JSON body required");
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BODY) { await reader.cancel(); throw new ResearchError(413, "Request too large"); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) { if (e instanceof ResearchError) throw e; throw new ResearchError(400, "Invalid JSON"); }
  finally { reader.releaseLock(); }
}
const validBatchId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9-]{1,80}$/.test(id);
export async function researchRequest(request: Request, action: "preview" | "publish" | "get", id?: string): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const owner = await authenticatePublisher(request);
    const now = Date.now(), key = owner.sub;
    let limit = requests.get(key); if (!limit || now - limit.start > 60_000) { limit = { start: now, count: 0 }; requests.set(key, limit); }
    if (++limit.count > 30) throw new ResearchError(429, "Publisher request limit reached; retry in one minute");
    // Authenticate and bound request input before opening a database connection.
    if (action === "get") { if (!validBatchId(id)) throw new ResearchError(400, "Invalid batch ID"); return Response.json(await getBatch(getAdminFirestore(), id, owner), { headers }); }
    const body = await readResearchJson(request);
    if (action === "preview") return Response.json(await previewBatch(getAdminFirestore(), body, owner), { headers });
    const input = body as { batchId?: unknown; previewToken?: unknown } | null;
    if (!input || !validBatchId(input.batchId) || typeof input.previewToken !== "string" || input.previewToken.length > 100) throw new ResearchError(400, "Batch ID and preview token required");
    return Response.json(await publishBatch(getAdminFirestore(), input.batchId, input.previewToken, owner), { headers });
  } catch (e) {
    const status = e instanceof ResearchError ? e.status : e instanceof AssertionError ? 409 : 500;
    const message = e instanceof ResearchError ? e.message : e instanceof AssertionError ? "Relationship conflict or stale preview; review a new batch" : "Research request failed";
    return Response.json({ error: message }, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}
