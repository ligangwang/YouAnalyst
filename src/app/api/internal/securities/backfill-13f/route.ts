import { isInternalRequest } from "@/lib/firebase/auth";
import { backfill13FFilings } from "@/lib/securities/thirteen-f-backfill";
import { NextRequest, NextResponse } from "next/server";

type Backfill13FRequest = {
  startDate?: unknown;
  endDate?: unknown;
  runId?: unknown;
  discoveryChunkDays?: unknown;
  maxFilingsPerIndex?: unknown;
  processBatchSize?: unknown;
  maxProcessBatches?: unknown;
  dryRun?: unknown;
  includeStaleProcessing?: unknown;
  staleProcessingMinutes?: unknown;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as Backfill13FRequest;
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
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to backfill SEC 13F filings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
