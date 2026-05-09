import { isInternalRequest } from "@/lib/firebase/auth";
import { discover13FFilings } from "@/lib/securities/thirteen-f-discovery";
import { NextRequest, NextResponse } from "next/server";

type Discover13FRequest = {
  date?: unknown;
  dates?: unknown;
  lookbackDays?: unknown;
  maxFilings?: unknown;
  dryRun?: unknown;
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
    const payload = (await request.json().catch(() => ({}))) as Discover13FRequest;
    const result = await discover13FFilings({
      date: readString(payload.date),
      dates: readStringArray(payload.dates),
      lookbackDays: readNumber(payload.lookbackDays),
      maxFilings: readNumber(payload.maxFilings),
      dryRun: readBoolean(payload.dryRun),
    });

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to discover SEC 13F filings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
