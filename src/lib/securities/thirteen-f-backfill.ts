import { getAdminFirestore } from "@/lib/firebase/admin";
import { discover13FFilings, Discover13FIndexResult } from "@/lib/securities/thirteen-f-discovery";
import { process13FQueue, Process13FQueueResult } from "@/lib/securities/thirteen-f-queue-worker";

const DEFAULT_START_DATE = "2026-01-01";
const DEFAULT_DISCOVERY_CHUNK_DAYS = 7;
const DEFAULT_PROCESS_BATCH_SIZE = 25;
const DEFAULT_MAX_PROCESS_BATCHES = 4;
const DEFAULT_MAX_FILINGS_PER_INDEX = 5000;
const MAX_BACKFILL_DAYS = 370;
const MAX_DISCOVERY_CHUNK_DAYS = 31;
const MAX_PROCESS_BATCHES = 100;

type Backfill13FStatus = "RUNNING" | "COMPLETED" | "PARTIAL" | "DRY_RUN" | "FAILED";

export type Backfill13FInput = {
  startDate?: string;
  endDate?: string;
  runId?: string;
  discoveryChunkDays?: number;
  maxFilingsPerIndex?: number;
  processBatchSize?: number;
  maxProcessBatches?: number;
  dryRun?: boolean;
  includeStaleProcessing?: boolean;
  staleProcessingMinutes?: number;
};

export type Backfill13FProcessBatchSummary = {
  processingRunId: string;
  candidatesFound: number;
  processed: number;
  parsed: number;
  failed: number;
  skipped: number;
  updatedAt: string;
};

export type Backfill13FResult = {
  dryRun: boolean;
  runId: string;
  status: Backfill13FStatus;
  startDate: string;
  endDate: string;
  datesRequested: number;
  discoveryChunksRequested: number;
  discoveryChunksCompleted: number;
  filingsFound: number;
  filingsQueued: number;
  filingsExisting: number;
  discoveryErrors: number;
  processingBatchesRequested: number;
  processingBatchesCompleted: number;
  queueCandidatesFound: number;
  filingsProcessed: number;
  filingsParsed: number;
  filingsFailed: number;
  filingsSkipped: number;
  discoveryIndexes: Discover13FIndexResult[];
  processBatches: Backfill13FProcessBatchSummary[];
  startedAt: string;
  updatedAt: string;
};

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatIsoDate(date) !== value.trim()) {
    return null;
  }

  return date;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  const today = new Date();
  return formatIsoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
}

function normalizeDateOrThrow(value: string | undefined, fallback: string, label: string): string {
  const date = parseIsoDate(value ?? fallback);
  if (!date) {
    throw new Error(`Invalid ${label} "${value}". Expected YYYY-MM-DD.`);
  }

  return formatIsoDate(date);
}

function datesBetween(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) {
    throw new Error("Invalid 13F backfill date range.");
  }

  if (start > end) {
    throw new Error("13F backfill startDate must be on or before endDate.");
  }

  const dates: string[] = [];
  for (let date = start; date <= end; date = new Date(date.getTime() + 24 * 60 * 60 * 1000)) {
    dates.push(formatIsoDate(date));
    if (dates.length > MAX_BACKFILL_DAYS) {
      throw new Error(`13F backfill date range cannot exceed ${MAX_BACKFILL_DAYS} days.`);
    }
  }

  return dates;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function backfillRunId(startDate: string, endDate: string, inputRunId: string | undefined): string {
  const raw = inputRunId?.trim() || `13f-backfill-${startDate}-to-${endDate}`;
  return raw.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
}

function summarizeProcessBatch(batch: Process13FQueueResult): Backfill13FProcessBatchSummary {
  return {
    processingRunId: batch.processingRunId,
    candidatesFound: batch.candidatesFound,
    processed: batch.processed,
    parsed: batch.parsed,
    failed: batch.failed,
    skipped: batch.skipped,
    updatedAt: batch.updatedAt,
  };
}

function sumDiscoveryIndexes(indexes: Discover13FIndexResult[]) {
  return {
    filingsFound: indexes.reduce((total, item) => total + item.filingsFound, 0),
    filingsQueued: indexes.reduce((total, item) => total + item.filingsQueued, 0),
    filingsExisting: indexes.reduce((total, item) => total + item.filingsExisting, 0),
    discoveryErrors: indexes.filter((item) => item.error).length,
  };
}

function sumProcessBatches(batches: Backfill13FProcessBatchSummary[]) {
  return {
    queueCandidatesFound: batches.reduce((total, item) => total + item.candidatesFound, 0),
    filingsProcessed: batches.reduce((total, item) => total + item.processed, 0),
    filingsParsed: batches.reduce((total, item) => total + item.parsed, 0),
    filingsFailed: batches.reduce((total, item) => total + item.failed, 0),
    filingsSkipped: batches.reduce((total, item) => total + item.skipped, 0),
  };
}

async function updateBackfillRun(runId: string, data: Record<string, unknown>): Promise<void> {
  const db = getAdminFirestore();
  await db.collection("sec_13f_backfill_runs").doc(runId).set(data, { merge: true });
}

export async function backfill13FFilings(input: Backfill13FInput): Promise<Backfill13FResult> {
  const dryRun = input.dryRun === true;
  const startDate = normalizeDateOrThrow(input.startDate, DEFAULT_START_DATE, "startDate");
  const endDate = normalizeDateOrThrow(input.endDate, todayIsoDate(), "endDate");
  const runId = backfillRunId(startDate, endDate, input.runId);
  const discoveryChunkDays = clampInteger(
    input.discoveryChunkDays,
    DEFAULT_DISCOVERY_CHUNK_DAYS,
    1,
    MAX_DISCOVERY_CHUNK_DAYS,
  );
  const maxFilingsPerIndex = clampInteger(input.maxFilingsPerIndex, DEFAULT_MAX_FILINGS_PER_INDEX, 1, DEFAULT_MAX_FILINGS_PER_INDEX);
  const processBatchSize = clampInteger(input.processBatchSize, DEFAULT_PROCESS_BATCH_SIZE, 1, 100);
  const maxProcessBatches = clampInteger(input.maxProcessBatches, DEFAULT_MAX_PROCESS_BATCHES, 0, MAX_PROCESS_BATCHES);
  const effectiveMaxProcessBatches = dryRun ? Math.min(maxProcessBatches, 1) : maxProcessBatches;
  const includeStaleProcessing = input.includeStaleProcessing !== false;
  const dates = datesBetween(startDate, endDate);
  const dateChunks = chunks(dates, discoveryChunkDays);
  const startedAt = new Date().toISOString();

  if (!dryRun) {
    await updateBackfillRun(runId, {
      runId,
      status: "RUNNING",
      startDate,
      endDate,
      datesRequested: dates.length,
      discoveryChunksRequested: dateChunks.length,
      processingBatchesRequested: effectiveMaxProcessBatches,
      startedAt,
      updatedAt: startedAt,
    });
  }

  const discoveryIndexes: Discover13FIndexResult[] = [];
  const processBatches: Backfill13FProcessBatchSummary[] = [];

  try {
    for (const dateChunk of dateChunks) {
      const result = await discover13FFilings({
        dates: dateChunk,
        maxFilings: maxFilingsPerIndex,
        dryRun,
      });

      discoveryIndexes.push(...result.indexes);

      if (!dryRun) {
        await updateBackfillRun(runId, {
          status: "RUNNING",
          discoveryChunksCompleted: discoveryIndexes.length === 0 ? 0 : Math.ceil(discoveryIndexes.length / discoveryChunkDays),
          lastDiscoveryIndexDate: dateChunk.at(-1) ?? null,
          ...sumDiscoveryIndexes(discoveryIndexes),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    for (let index = 0; index < effectiveMaxProcessBatches; index += 1) {
      const result = await process13FQueue({
        limit: processBatchSize,
        dryRun,
        includeStaleProcessing,
        staleProcessingMinutes: input.staleProcessingMinutes,
      });
      const summary = summarizeProcessBatch(result);
      processBatches.push(summary);

      if (!dryRun) {
        await updateBackfillRun(runId, {
          status: "RUNNING",
          processingBatchesCompleted: processBatches.length,
          lastProcessingRunId: summary.processingRunId,
          ...sumProcessBatches(processBatches),
          updatedAt: new Date().toISOString(),
        });
      }

      if (result.candidatesFound === 0) {
        break;
      }
    }

    const discoverySummary = sumDiscoveryIndexes(discoveryIndexes);
    const processSummary = sumProcessBatches(processBatches);
    const exhaustedProcessingBudget = processBatches.length >= effectiveMaxProcessBatches &&
      effectiveMaxProcessBatches > 0 &&
      (processBatches.at(-1)?.candidatesFound ?? 0) >= processBatchSize;
    const status: Backfill13FStatus = dryRun
      ? "DRY_RUN"
      : discoverySummary.discoveryErrors > 0 || processSummary.filingsFailed > 0 || exhaustedProcessingBudget
        ? "PARTIAL"
        : "COMPLETED";
    const updatedAt = new Date().toISOString();
    const output: Backfill13FResult = {
      dryRun,
      runId,
      status,
      startDate,
      endDate,
      datesRequested: dates.length,
      discoveryChunksRequested: dateChunks.length,
      discoveryChunksCompleted: dateChunks.length,
      filingsFound: discoverySummary.filingsFound,
      filingsQueued: discoverySummary.filingsQueued,
      filingsExisting: discoverySummary.filingsExisting,
      discoveryErrors: discoverySummary.discoveryErrors,
      processingBatchesRequested: effectiveMaxProcessBatches,
      processingBatchesCompleted: processBatches.length,
      queueCandidatesFound: processSummary.queueCandidatesFound,
      filingsProcessed: processSummary.filingsProcessed,
      filingsParsed: processSummary.filingsParsed,
      filingsFailed: processSummary.filingsFailed,
      filingsSkipped: processSummary.filingsSkipped,
      discoveryIndexes,
      processBatches,
      startedAt,
      updatedAt,
    };

    if (!dryRun) {
      await updateBackfillRun(runId, output);
    }

    return output;
  } catch (error) {
    const updatedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Failed to backfill SEC 13F filings";
    if (!dryRun) {
      await updateBackfillRun(runId, {
        status: "FAILED",
        lastError: message,
        updatedAt,
      });
    }

    throw error;
  }
}
