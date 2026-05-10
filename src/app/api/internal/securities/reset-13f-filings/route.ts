import { isInternalRequest } from "@/lib/firebase/auth";
import { resetThirteenFFilingsForReprocessing } from "@/lib/securities/thirteen-f-ops";
import type { QueueStatus } from "@/lib/securities/thirteen-f-ops";
import { NextRequest, NextResponse } from "next/server";

type Reset13FFilingsRequest = {
  fromStatus?: unknown;
  filingDateFrom?: unknown;
  limit?: unknown;
  dryRun?: unknown;
  reason?: unknown;
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
    const payload = (await request.json().catch(() => ({}))) as Reset13FFilingsRequest;
    const result = await resetThirteenFFilingsForReprocessing({
      fromStatus: readString(payload.fromStatus) as QueueStatus | undefined,
      filingDateFrom: readString(payload.filingDateFrom),
      limit: readNumber(payload.limit),
      dryRun: readBoolean(payload.dryRun),
      reason: readString(payload.reason),
    });

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset SEC 13F filings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
