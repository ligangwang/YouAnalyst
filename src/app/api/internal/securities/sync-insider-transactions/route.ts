import { isInternalRequest } from "@/lib/firebase/auth";
import { syncInsiderTransactions } from "@/lib/securities/insider-transactions";
import { NextRequest, NextResponse } from "next/server";

type SyncInsiderTransactionsRequest = {
  date?: unknown;
  dates?: unknown;
  lookbackDays?: unknown;
  maxFilings?: unknown;
  transactionCodes?: unknown;
  dryRun?: unknown;
  reprocessExisting?: unknown;
  includeStaleProcessing?: unknown;
  staleProcessingMinutes?: unknown;
  processOnly?: unknown;
};

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

export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as SyncInsiderTransactionsRequest;
    const result = await syncInsiderTransactions({
      date: readString(payload.date),
      dates: readStringArray(payload.dates),
      lookbackDays: readNumber(payload.lookbackDays),
      maxFilings: readNumber(payload.maxFilings),
      transactionCodes: readStringArray(payload.transactionCodes),
      dryRun: readBoolean(payload.dryRun),
      reprocessExisting: readBoolean(payload.reprocessExisting),
      includeStaleProcessing: readBoolean(payload.includeStaleProcessing),
      staleProcessingMinutes: readNumber(payload.staleProcessingMinutes),
      processOnly: readBoolean(payload.processOnly),
    });

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync SEC insider transactions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
