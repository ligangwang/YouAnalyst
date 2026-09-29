import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "../firebase/auth";
import { isAdminUser } from "../firebase/admin-role";
import { getAdminFirestore } from "../firebase/admin";
import { acquireMaintenanceLease, releaseMaintenanceLease } from "../maintenance-lease";
import { createMaintenanceLog, maintenanceError } from "../maintenance-log";
import { runTickerCatalogSync } from "../tickers/sync-tickers";
import { tickerSyncInput } from "../tickers/sync-input";
import { queueTickerSync } from "../tickers/pubsub";
export { tickerSyncInput } from "../tickers/sync-input";

export async function syncAdminTickers(input: ReturnType<typeof tickerSyncInput>, uid: string) {
  if (!input.dryRun) return queueTickerSync(input, uid, getAdminFirestore());
  const log = createMaintenanceLog("sync-tickers", {requestedBy: uid, dryRun: input.dryRun});
  // Reuse the existing sync metadata collection; never store job history in a new collection.
  const lease = getAdminFirestore().collection("directory_syncs").doc("TICKER_CATALOG");
  if (!await acquireMaintenanceLease(lease, log.runId)) throw Object.assign(Error("Ticker sync is already running."), {code: "ALREADY_RUNNING"});
  log.emit("INFO", "run_started", input);
  try {
    const result = await runTickerCatalogSync(input);
    log.emit("INFO", "run_completed", result);
    return {runId: log.runId, ...result};
  } catch (error) {
    log.emit("ERROR", "run_failed", {error: maintenanceError(error)});
    throw error;
  } finally {
    await releaseMaintenanceLease(lease, log.runId).catch(error => log.emit("ERROR", "lease_release_failed", {error: maintenanceError(error)}));
  }
}

export async function runTickerResponse(request: NextRequest, dependencies = {getUser: getDecodedUserFromRequest, isAdmin: isAdminUser, run: syncAdminTickers}) {
  const reply = (data: unknown, status: number) => NextResponse.json(data, {status, headers: {"Cache-Control": "private, no-store"}});
  const user = await dependencies.getUser(request);
  if (!user) return reply({error: "Unauthorized"}, 401);
  if (!await dependencies.isAdmin(user)) return reply({error: "Forbidden"}, 403);
  let input: ReturnType<typeof tickerSyncInput>;
  try { input = tickerSyncInput(await request.json()); }
  catch (error) { return reply({error: error instanceof Error ? error.message : "Invalid input"}, 400); }
  try { return reply({ok: true, ...await dependencies.run(input, user.uid)}, input.dryRun ? 200 : 202); }
  catch (error) {
    const busy = maintenanceError(error).code === "ALREADY_RUNNING";
    return reply({error: busy ? "Ticker sync is already queued or running. Check run history." : "Could not confirm the request. Check run history, then retry with the same options."}, busy ? 409 : 502);
  }
}
