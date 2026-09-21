import { GoogleAuth } from "google-auth-library";
import { scheduledJobs, type JobId, type HistoryView, type JobRecord, type JobHistoryPage } from "./model";

type LogEntry = { insertId?: string; timestamp?: string; severity?: string; jsonPayload?: Record<string, unknown>; textPayload?: string; labels?: Record<string, string> };
type LogPage = { entries?: LogEntry[]; nextPageToken?: string };
type Execution = { name: string; createTime: string; startTime?: string; completionTime?: string; cancelledCount?: number; conditions?: { type: string; state: string; message?: string }[] };
export type CloudRequest = <T>(url: string, data?: unknown) => Promise<T>;
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const cloudRequest: CloudRequest = async <T>(url: string, data?: unknown) => {
  const client = await auth.getClient();
  return (await client.request<T>({ url, method: data ? "POST" : "GET", data, timeout: 20_000, retry: false })).data;
};
const q = (value: string) => JSON.stringify(value);
const terminal = '(jsonPayload.message=~": run_(completed|failed)$")';
const failedSeverity = (severity?: string) => ["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(severity ?? "");

// The server chooses the project, job, filter and bounded page size. Clients may
// only supply an opaque provider cursor, never a raw Logging filter or URL.
export async function loadJobHistory(input: { job: JobId; view: HistoryView; pageToken?: string; runId?: string; execution?: string }, request: CloudRequest = cloudRequest, project = process.env.GCP_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID): Promise<JobHistoryPage> {
  if (!project) throw new Error("Google Cloud project is not configured");
  const job = scheduledJobs[input.job];
  const region = process.env.GCP_REGION || "us-central1";
  const source = job.worker
    ? `resource.type="cloud_run_job" resource.labels.job_name=${q(job.worker)}`
    : `resource.type="cloud_run_revision" jsonPayload.job=${q(job.logJob)} jsonPayload.market=${q("market" in job ? job.market : "")}`;
  const listLogs = (filter: string, pageToken?: string, pageSize = 20) => request<LogPage>("https://logging.googleapis.com/v2/entries:list", {
    resourceNames: [`projects/${project}`], filter, orderBy: "timestamp desc", pageSize, ...(pageToken ? { pageToken } : {}),
  });
  const findResults = async (filter: string, ids: string[], getId: (entry: LogEntry) => unknown) => {
    const entries: LogEntry[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 3; page++) {
      const result = await listLogs(filter, pageToken, 200);
      entries.push(...result.entries ?? []);
      pageToken = result.nextPageToken;
      if (!pageToken || ids.every(id => entries.some(entry => getId(entry) === id))) return { entries, incomplete: false };
    }
    return { entries, incomplete: Boolean(pageToken) };
  };
  if (input.view !== "runs") {
    let filter = source;
    if (input.view === "scheduler") filter = `resource.type="cloud_scheduler_job" resource.labels.job_id=${q(job.scheduler)}`;
    else if (input.job === "fundamentals" && input.view === "errors" && !input.execution) {
      filter = `(${source} OR ((resource.type="cloud_run_revision" OR resource.type="cloud_run_job") jsonPayload.event="sec_request_failed"))`;
    }
    if (input.view === "errors") filter += " severity>=WARNING";
    if (input.view !== "scheduler") {
      if (input.runId) filter += ` jsonPayload.runId=${q(input.runId)}`;
      if (input.execution) filter += ` labels."run.googleapis.com/execution_name"=${q(input.execution)}`;
    }
    const page = await listLogs(filter, input.pageToken);
    return { records: (page.entries ?? []).map(logRecord), nextPageToken: page.nextPageToken || null };
  }

  if (job.worker) {
    const params = new URLSearchParams({ pageSize: "20" });
    if (input.pageToken) params.set("pageToken", input.pageToken);
    const page = await request<{ executions?: Execution[]; nextPageToken?: string }>(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job.worker}/executions?${params}`);
    const executions = page.executions ?? [];
    let summaries: LogEntry[] = [];
    let warning: string | undefined;
    if (executions.length) {
      try {
        const ids = executions.map(e => e.name.split("/").pop()!);
        const logs = await findResults(`${source} ${terminal} labels."run.googleapis.com/execution_name"=(${ids.map(q).join(" OR ")})`, ids, entry => entry.labels?.["run.googleapis.com/execution_name"]);
        summaries = logs.entries;
        if (logs.incomplete) warning = "Some summaries are unavailable. Open run logs for the full history.";
      } catch { warning = "Run status is available, but result logs could not be loaded. Try refreshing."; }
    }
    return { records: executions.map(e => {
      const execution = e.name.split("/").pop()!;
      const completed = e.conditions?.find(c => c.type === "Completed");
      const summary = summaries.find(s => s.labels?.["run.googleapis.com/execution_name"] === execution)?.jsonPayload ?? {};
      const status = e.cancelledCount ? "Cancelled" : completed?.state === "CONDITION_SUCCEEDED" ? "Succeeded"
        : completed?.state === "CONDITION_FAILED" ? "Failed" : e.completionTime ? "Unknown" : "Running";
      return { id: execution, execution, startedAt: e.startTime || e.createTime, endedAt: e.completionTime, status,
        durationMs: e.completionTime ? Date.parse(e.completionTime) - Date.parse(e.startTime || e.createTime) : undefined,
        summary: cleanDetails(summary), message: completed?.message };
    }), nextPageToken: page.nextPageToken || null, warning };
  }

  const page = await listLogs(`${source} jsonPayload.message="daily-eod-maintenance: run_started"`, input.pageToken);
  const starts = page.entries ?? [];
  const ids = starts.map(s => s.jsonPayload?.runId).filter((id): id is string => typeof id === "string");
  // Result query is bounded by the 20 run IDs in this page. Do not load all history.
  const results = ids.length ? await findResults(`${source} ${terminal} jsonPayload.runId=(${ids.map(q).join(" OR ")})`, ids, entry => entry.jsonPayload?.runId) : { entries: [], incomplete: false };
  return { records: starts.map(start => {
    const runId = String(start.jsonPayload?.runId ?? start.insertId);
    const end = results.entries?.find(log => log.jsonPayload?.runId === runId);
    const payload = end?.jsonPayload ?? {};
    const partial = Number((payload.priceLoad as { failed?: number } | undefined)?.failed ?? 0) > 0;
    const status = end ? (String(payload.message).endsWith("run_failed") || failedSeverity(end.severity) ? "Failed" : partial ? "Completed with errors" : "Succeeded")
      : results.incomplete ? "Unknown" : Date.now() - Date.parse(start.timestamp ?? "") < 3_600_000 ? "Running" : "No completion recorded";
    return { id: runId, runId, startedAt: start.timestamp ?? "", endedAt: end?.timestamp, status,
      durationMs: typeof payload.elapsedMs === "number" ? payload.elapsedMs : undefined, summary: cleanDetails(payload) };
  }), nextPageToken: page.nextPageToken || null, warning: results.incomplete ? "Some result logs are unavailable. Open run logs or refresh to check the outcome." : undefined };
}

// Keep operational details, but exclude credentials or arbitrary request bodies
// if a provider adds them to a payload in the future.
export function cleanDetails(value: Record<string, unknown>): Record<string, unknown> {
  const sanitize = (item: unknown, depth: number): unknown => {
    if (depth > 8) return "[truncated]";
    if (typeof item === "string") return item.replace(/(Bearer\s+)\S+/gi, "$1[REDACTED]").replace(/([?&](?:api_?key|token|key|access_token)=)[^&\s]+/gi, "$1[REDACTED]").slice(0, 12000);
    if (Array.isArray(item)) return item.slice(0, 100).map(v => sanitize(v, depth + 1));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).slice(0, 100)
      .filter(([key]) => !/authorization|cookie|secret|password|headers|^body$|token|credential/i.test(key)).map(([key, v]) => [key, sanitize(v, depth + 1)]));
    return item;
  };
  return sanitize(value, 0) as Record<string, unknown>;
}
function logRecord(entry: LogEntry): JobRecord {
  const payload = entry.jsonPayload ?? {};
  const scheduler = String(payload["@type"] ?? "");
  const status = scheduler.endsWith("AttemptStarted") ? "Delivery started" : scheduler.endsWith("AttemptFinished")
    ? failedSeverity(entry.severity) || (payload.status && payload.status !== "OK") ? "Delivery failed" : "Delivered"
    : entry.severity || "INFO";
  const summary = cleanDetails(payload);
  return { id: entry.insertId ?? `${entry.timestamp}-${payload.runId}`, startedAt: entry.timestamp ?? "", status,
    summary, message: String(summary.message ?? summary.debugInfo ?? cleanDetails({ text: entry.textPayload ?? "" }).text),
    runId: typeof payload.runId === "string" ? payload.runId : undefined, execution: entry.labels?.["run.googleapis.com/execution_name"] };
}
