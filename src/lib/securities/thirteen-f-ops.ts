import { getAdminFirestore } from "@/lib/firebase/admin";

type QueueStatus = "DISCOVERED" | "PROCESSING" | "PARSED" | "FAILED" | "SKIPPED";

export type ThirteenFQueueStatusSummary = Record<QueueStatus, number>;

export type ThirteenFRecentFiling = {
  accessionNumber: string;
  managerCik: string | null;
  managerName: string | null;
  form: string | null;
  filingDate: string | null;
  reportDate: string | null;
  status: string | null;
  canonicalStatus: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: string | null;
  processedAt: string | null;
};

export type ThirteenFBackfillRunSummary = {
  runId: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  filingsFound: number;
  filingsQueued: number;
  filingsProcessed: number;
  filingsParsed: number;
  filingsFailed: number;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string | null;
};

export type ThirteenFOpsAlert = {
  level: "info" | "warning" | "critical";
  label: string;
  message: string;
};

export type ThirteenFOpsSummary = {
  queue: {
    statuses: ThirteenFQueueStatusSummary;
    queuedOrProcessing: number;
    staleProcessing: number;
  };
  latestParsed: ThirteenFRecentFiling | null;
  recentFailures: ThirteenFRecentFiling[];
  recentFilings: ThirteenFRecentFiling[];
  recentBackfills: ThirteenFBackfillRunSummary[];
  alerts: ThirteenFOpsAlert[];
  generatedAt: string;
};

const QUEUE_STATUSES: QueueStatus[] = ["DISCOVERED", "PROCESSING", "PARSED", "FAILED", "SKIPPED"];

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readIsoLike(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate() as Date;
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function staleProcessingCutoff(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function normalizeRecentFiling(id: string, data: Record<string, unknown>): ThirteenFRecentFiling {
  return {
    accessionNumber: readString(data.accessionNumber) ?? id,
    managerCik: readString(data.managerCik),
    managerName: readString(data.managerName),
    form: readString(data.form),
    filingDate: readString(data.filingDate),
    reportDate: readString(data.reportDate),
    status: readString(data.status),
    canonicalStatus: readString(data.canonicalStatus),
    attempts: readNumber(data.attempts),
    lastError: readString(data.lastError),
    updatedAt: readIsoLike(data.updatedAt),
    processedAt: readIsoLike(data.processedAt),
  };
}

function normalizeBackfillRun(id: string, data: Record<string, unknown>): ThirteenFBackfillRunSummary {
  return {
    runId: readString(data.runId) ?? id,
    status: readString(data.status),
    startDate: readString(data.startDate),
    endDate: readString(data.endDate),
    filingsFound: readNumber(data.filingsFound),
    filingsQueued: readNumber(data.filingsQueued),
    filingsProcessed: readNumber(data.filingsProcessed),
    filingsParsed: readNumber(data.filingsParsed),
    filingsFailed: readNumber(data.filingsFailed),
    lastError: readString(data.lastError),
    startedAt: readIsoLike(data.startedAt),
    updatedAt: readIsoLike(data.updatedAt),
  };
}

async function queueStatusCounts(): Promise<ThirteenFQueueStatusSummary> {
  const db = getAdminFirestore();
  const entries = await Promise.all(QUEUE_STATUSES.map(async (status) => {
    const snapshot = await db.collection("sec_13f_filings").where("status", "==", status).count().get();
    return [status, snapshot.data().count] as const;
  }));

  return Object.fromEntries(entries) as ThirteenFQueueStatusSummary;
}

async function countStaleProcessing(minutes: number): Promise<number> {
  const cutoff = staleProcessingCutoff(minutes);
  const snapshot = await getAdminFirestore()
    .collection("sec_13f_filings")
    .where("status", "==", "PROCESSING")
    .limit(200)
    .get();

  return snapshot.docs.filter((doc) => {
    const startedAt = readIsoLike(doc.get("processingStartedAt"));
    return !startedAt || startedAt <= cutoff;
  }).length;
}

function buildOpsAlerts(input: {
  statuses: ThirteenFQueueStatusSummary;
  staleProcessing: number;
  latestParsed: ThirteenFRecentFiling | null;
}): ThirteenFOpsAlert[] {
  const alerts: ThirteenFOpsAlert[] = [];

  if (input.staleProcessing > 0) {
    alerts.push({
      level: "critical",
      label: "Stale processing",
      message: `${input.staleProcessing.toLocaleString()} filing(s) have been processing for more than 60 minutes.`,
    });
  }

  if (input.statuses.FAILED > 0) {
    alerts.push({
      level: "warning",
      label: "Failed filings",
      message: `${input.statuses.FAILED.toLocaleString()} filing(s) are currently marked failed.`,
    });
  }

  if (!input.latestParsed) {
    alerts.push({
      level: "warning",
      label: "No parsed filing",
      message: "No parsed 13F filing was found. Confirm discovery and queue processing have run.",
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      level: "info",
      label: "Pipeline nominal",
      message: "No failed or stale processing filings are currently visible in the 13F operations snapshot.",
    });
  }

  return alerts;
}

export async function getThirteenFOpsSummary(): Promise<ThirteenFOpsSummary> {
  const db = getAdminFirestore();
  const [statuses, staleProcessing, latestParsedSnapshot, recentSnapshot, recentBackfillSnapshot] = await Promise.all([
    queueStatusCounts(),
    countStaleProcessing(60),
    db.collection("sec_13f_filings").orderBy("processedAt", "desc").limit(1).get(),
    db.collection("sec_13f_filings").orderBy("updatedAt", "desc").limit(50).get(),
    db.collection("sec_13f_backfill_runs").orderBy("updatedAt", "desc").limit(10).get(),
  ]);
  const recentFilings = recentSnapshot.docs.map((doc) => normalizeRecentFiling(doc.id, doc.data()));
  const latestParsed = latestParsedSnapshot.docs[0]
    ? normalizeRecentFiling(latestParsedSnapshot.docs[0].id, latestParsedSnapshot.docs[0].data())
    : null;

  return {
    queue: {
      statuses,
      queuedOrProcessing: statuses.DISCOVERED + statuses.PROCESSING,
      staleProcessing,
    },
    latestParsed,
    recentFailures: recentFilings.filter((filing) => filing.status === "FAILED").slice(0, 10),
    recentFilings,
    recentBackfills: recentBackfillSnapshot.docs.map((doc) => normalizeBackfillRun(doc.id, doc.data())),
    alerts: buildOpsAlerts({ statuses, staleProcessing, latestParsed }),
    generatedAt: new Date().toISOString(),
  };
}
