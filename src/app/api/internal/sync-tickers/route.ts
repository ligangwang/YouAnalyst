import { isInternalRequest } from "@/lib/firebase/auth";
import { syncAdminTickers, tickerSyncInput } from "@/lib/admin-jobs/tickers";
import { NextRequest, NextResponse } from "next/server";

type SyncTickersRequest = {
  dryRun?: unknown;
  country?: unknown;
  currency?: unknown;
  types?: unknown;
  limit?: unknown;
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

function readTypes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const types = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return types.length > 0 ? types : undefined;
}

export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as SyncTickersRequest;
    const result = await syncAdminTickers(tickerSyncInput({
      dryRun: readBoolean(payload.dryRun) ?? true,
      country: readString(payload.country),
      currency: readString(payload.currency),
      types: readTypes(payload.types),
      limit: readNumber(payload.limit),
    }), "internal");

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    }, { status: result.dryRun ? 200 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync tickers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
