import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "../firebase/auth";
import { isAdminUser } from "../firebase/admin-role";
import { runDailyEodMaintenance } from "../predictions/eod-prices";
import { marketDate } from "../predictions/instrument";
import { maintenanceError } from "../maintenance-log";

export async function rerunEodResponse(request: NextRequest, dependencies = { getUser: getDecodedUserFromRequest, isAdmin: isAdminUser, run: runDailyEodMaintenance }) {
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
  const user = await dependencies.getUser(request);
  if (!user) return reply({ error: "Unauthorized" }, 401);
  if (!await dependencies.isAdmin(user)) return reply({ error: "Forbidden" }, 403);
  const body = await request.json().catch(() => null);
  if (!body || !["us", "china"].includes(body.job) || typeof body.runDate !== "string") return reply({ error: "Select a US or China EOD job and a date." }, 400);
  const market = body.job === "us" ? "US" : "CN_A";
  const date = new Date(`${body.runDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.runDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.runDate || body.runDate > marketDate(market)) {
    return reply({ error: "Choose a valid date that is not in the future for this market." }, 400);
  }
  try {
    // Keep the same maintenance behavior as Scheduler; do not expose arbitrary
    // internal options, forced score recomputation or cross-date roll-forward.
    const result = await dependencies.run({ market, runDate: body.runDate, limit: 500, trigger: "admin", requestedBy: user.uid });
    return reply({ ok: true, result });
  } catch (error) {
    const details = maintenanceError(error);
    console.error(JSON.stringify({ severity: "ERROR", event: "admin_eod_rerun_failed", market, runDate: body.runDate, requestedBy: user.uid, error: details }));
    return reply({ error: details.code === "EOD_ALREADY_RUNNING" ? "An EOD job is already running for this market. Check run history before retrying." : "EOD maintenance failed. Check run history for error details." }, details.code === "EOD_ALREADY_RUNNING" ? 409 : 500);
  }
}
