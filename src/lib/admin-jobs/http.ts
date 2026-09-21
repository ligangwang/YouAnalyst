import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { scheduledJobs, type JobId, type HistoryView } from "@/lib/admin-jobs/model";
import { loadJobHistory } from "@/lib/admin-jobs/service";
import { maintenanceError } from "@/lib/maintenance-log";

export async function jobHistoryResponse(request: NextRequest, dependencies = { getUser: getDecodedUserFromRequest, isAdmin: isAdminUser, load: loadJobHistory }) {
  const decoded = await dependencies.getUser(request);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  if (!await dependencies.isAdmin(decoded)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const params = request.nextUrl.searchParams;
  const job = params.get("job") ?? "fundamentals";
  const view = params.get("view") ?? "runs";
  const pageToken = params.get("pageToken") || undefined;
  const runId = params.get("runId") || undefined;
  const execution = params.get("execution") || undefined;
  if (!Object.hasOwn(scheduledJobs, job) || !["runs", "errors", "logs", "scheduler"].includes(view)
    || (pageToken && pageToken.length > 16000) || [runId, execution].some(id => id && !/^[a-zA-Z0-9_-]{1,200}$/.test(id))) {
    return NextResponse.json({ error: "Invalid job history request" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    return NextResponse.json(await dependencies.load({ job: job as JobId, view: view as HistoryView, pageToken, runId, execution }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ severity: "ERROR", event: "admin_job_history_failed", job, view, error: maintenanceError(error) }));
    return NextResponse.json({ error: "Unable to load job history. Check Cloud Logging and Cloud Run read permissions, then retry." }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}
