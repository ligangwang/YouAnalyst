import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { backfill13FFilings } from "@/lib/securities/thirteen-f-backfill";
import { discover13FFilings } from "@/lib/securities/thirteen-f-discovery";
import { getThirteenFOpsSummary, resetThirteenFFilingsForReprocessing } from "@/lib/securities/thirteen-f-ops";
import type { QueueStatus } from "@/lib/securities/thirteen-f-ops";
import { process13FQueue } from "@/lib/securities/thirteen-f-queue-worker";
import { NextRequest, NextResponse } from "next/server";

type Admin13FActionRequest = {
  action?: unknown;
  date?: unknown;
  dates?: unknown;
  lookbackDays?: unknown;
  maxFilings?: unknown;
  limit?: unknown;
  includeStaleProcessing?: unknown;
  staleProcessingMinutes?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  runId?: unknown;
  discoveryChunkDays?: unknown;
  maxFilingsPerIndex?: unknown;
  processBatchSize?: unknown;
  maxProcessBatches?: unknown;
  dryRun?: unknown;
  fromStatus?: unknown;
  reason?: unknown;
};

async function assertAdmin(request: NextRequest): Promise<NextResponse | null> {
  const decoded = await getDecodedUserFromRequest(request);

  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdminUser(decoded)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return values.length > 0 ? values : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const adminError = await assertAdmin(request);
  if (adminError) {
    return adminError;
  }

  try {
    return NextResponse.json(await getThirteenFOpsSummary());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load 13F operations.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const adminError = await assertAdmin(request);
  if (adminError) {
    return adminError;
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as Admin13FActionRequest;
    const action = readString(payload.action);

    if (action === "discover") {
      const result = await discover13FFilings({
        date: readString(payload.date),
        dates: readStringArray(payload.dates),
        lookbackDays: readNumber(payload.lookbackDays),
        maxFilings: readNumber(payload.maxFilings),
        dryRun: readBoolean(payload.dryRun),
      });

      return NextResponse.json({
        ok: true,
        action,
        result,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === "processQueue") {
      const result = await process13FQueue({
        limit: readNumber(payload.limit),
        dryRun: readBoolean(payload.dryRun),
        includeStaleProcessing: readBoolean(payload.includeStaleProcessing),
        staleProcessingMinutes: readNumber(payload.staleProcessingMinutes),
      });

      return NextResponse.json({
        ok: true,
        action,
        result,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === "backfill") {
      const result = await backfill13FFilings({
        startDate: readString(payload.startDate),
        endDate: readString(payload.endDate),
        runId: readString(payload.runId),
        discoveryChunkDays: readNumber(payload.discoveryChunkDays),
        maxFilingsPerIndex: readNumber(payload.maxFilingsPerIndex),
        processBatchSize: readNumber(payload.processBatchSize),
        maxProcessBatches: readNumber(payload.maxProcessBatches),
        dryRun: readBoolean(payload.dryRun),
        includeStaleProcessing: readBoolean(payload.includeStaleProcessing),
        staleProcessingMinutes: readNumber(payload.staleProcessingMinutes),
      });

      return NextResponse.json({
        ok: true,
        action,
        result,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === "resetFilings") {
      const result = await resetThirteenFFilingsForReprocessing({
        fromStatus: readString(payload.fromStatus) as QueueStatus | undefined,
        limit: readNumber(payload.limit),
        dryRun: readBoolean(payload.dryRun),
        reason: readString(payload.reason),
      });

      return NextResponse.json({
        ok: true,
        action,
        result,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({ error: "Unsupported 13F admin action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run 13F admin action.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
