import { isInternalRequest } from "@/lib/firebase/auth";
import { runDailyEodMaintenance } from "@/lib/predictions/eod-prices";
import { NextRequest, NextResponse } from "next/server";

type DailyEodMaintenanceRequest = {
  runDate?: unknown;
  limit?: unknown;
  dryRun?: unknown;
  tickers?: unknown;
  loadPrices?: unknown;
  markPredictions?: unknown;
  rollForward?: unknown;
  rollForwardBatchSize?: unknown;
  recompute?: unknown;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readTickers(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tickers = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return tickers.length > 0 ? tickers : undefined;
}

export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as DailyEodMaintenanceRequest;
    const result = await runDailyEodMaintenance({
      runDate: readString(payload.runDate),
      limit: Number.isFinite(payload.limit) ? Number(payload.limit) : undefined,
      dryRun: readBoolean(payload.dryRun),
      tickers: readTickers(payload.tickers),
      loadPrices: readBoolean(payload.loadPrices),
      markPredictions: readBoolean(payload.markPredictions),
      rollForward: readBoolean(payload.rollForward),
      rollForwardBatchSize: Number.isFinite(payload.rollForwardBatchSize) ? Number(payload.rollForwardBatchSize) : undefined,
      recompute: readBoolean(payload.recompute),
    });

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run daily EOD maintenance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
