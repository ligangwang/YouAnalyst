import { isInternalRequest } from "@/lib/firebase/auth";
import { process13FQueue } from "@/lib/securities/thirteen-f-queue-worker";
import { NextRequest, NextResponse } from "next/server";

type Process13FQueueRequest = {
  limit?: unknown;
  dryRun?: unknown;
  includeStaleProcessing?: unknown;
  staleProcessingMinutes?: unknown;
};

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
    const payload = (await request.json().catch(() => ({}))) as Process13FQueueRequest;
    const result = await process13FQueue({
      limit: readNumber(payload.limit),
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
    const message = error instanceof Error ? error.message : "Failed to process queued SEC 13F filings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
