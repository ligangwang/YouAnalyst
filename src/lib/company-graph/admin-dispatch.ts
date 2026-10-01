import { randomUUID } from "node:crypto";
import { getAdminFirestore } from "../firebase/admin";
import { enqueueCompanyGraphRequest, claimCompanyGraphRequest, finishCompanyGraphRequest } from "./requests";
import { publishCompanyGraphRequest } from "./pubsub";
import { dispatchCompanyGraphRequest } from "./queue-worker";
import { runLatest10KCompanyGraphExtraction } from "./service";

export async function dispatchAdminCompanyGraph(input: { ticker: string; force?: boolean; direct?: boolean; dryRun?: boolean }) {
  if (input.dryRun === true) return runLatest10KCompanyGraphExtraction({ ...input, dryRun: true });
  const db = getAdminFirestore();
  const queued = await enqueueCompanyGraphRequest(input.ticker, { force: input.force, replay: true, db });
  if (!queued.request) return queued;
  if (!input.direct && process.env.COMPANY_GRAPH_REQUEST_TOPIC) {
    try { return { ...queued, dispatch: await dispatchCompanyGraphRequest(queued.request, db, publishCompanyGraphRequest) }; }
    catch (error) { return { ...queued, dispatch: { status: "PENDING", error: error instanceof Error ? error.message : "Publication failed" } }; }
  }
  // Transitional compatibility: an authorized operator retains direct execution
  // until Pub/Sub is configured. Anonymous request routes never call this helper.
  const owner = `admin_${randomUUID()}`;
  const claimed = await claimCompanyGraphRequest(queued.request, owner, db);
  if (claimed !== "claimed") return queued;
  try {
    const result = await runLatest10KCompanyGraphExtraction({ ticker: queued.ticker, force: queued.request.force,
      dryRun: false, requestId: queued.request.requestId, requestedAt: queued.request.requestedAt, requestGeneration: queued.request.generation }, { db });
    await finishCompanyGraphRequest(queued.request, owner, { edgeCount: result.edges.length }, db);
    return result;
  } catch (error) {
    await finishCompanyGraphRequest(queued.request, owner, { error: error instanceof Error ? error.message : "Extraction failed" }, db);
    throw error;
  }
}
