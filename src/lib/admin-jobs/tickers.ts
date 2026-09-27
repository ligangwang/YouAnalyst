import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "../firebase/auth";
import { isAdminUser } from "../firebase/admin-role";
import { getAdminFirestore } from "../firebase/admin";
import { acquireMaintenanceLease, releaseMaintenanceLease } from "../maintenance-lease";
import { createMaintenanceLog, maintenanceError } from "../maintenance-log";
import { runTickerCatalogSync } from "../tickers/sync-tickers";

export function tickerSyncInput(body: unknown) {
  if (!body || typeof body !== "object") throw Error("Choose preview or sync.");
  const b = body as Record<string, unknown>;
  if (typeof b.dryRun !== "boolean") throw Error("Choose preview or sync.");
  const field = (key: string, fallback: string) => {
    if (b[key] === undefined) return fallback;
    if (typeof b[key] !== "string" || !b[key].trim() || b[key].length > 120) throw Error(`Invalid ${key}.`);
    return b[key].trim();
  };
  const country = field("country", "United States"), currency = field("currency", "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw Error("Use a three-letter currency code.");
  if (b.limit !== undefined && (!Number.isInteger(b.limit) || Number(b.limit) < 1 || Number(b.limit) > 50000)) throw Error("Limit must be 1–50000, or blank for all.");
  if (b.types !== undefined && (!Array.isArray(b.types) || !b.types.length || b.types.length > 20 || b.types.some(t => typeof t !== "string" || !t.trim() || t.length > 100))) throw Error("Invalid security types.");
  return { dryRun: b.dryRun, country, currency, limit: b.limit as number | undefined, types: b.types as string[] | undefined };
}

export async function syncAdminTickers(input: ReturnType<typeof tickerSyncInput>, uid: string) {
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
  try { return reply({ok: true, ...await dependencies.run(input, user.uid)}, 200); }
  catch (error) {
    const busy = maintenanceError(error).code === "ALREADY_RUNNING";
    return reply({error: busy ? "Ticker sync is already running. Check run history." : "Sync did not complete successfully. Some batches may have been written. Check run history before retrying."}, busy ? 409 : 502);
  }
}
