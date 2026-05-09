import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { getCusipMappingGapsSummary } from "@/lib/securities/cusip-mapping-gaps";
import { applyCusipMappingOverride, applyMappedCusipOverrides, upsertCusipMappingOverride } from "@/lib/securities/mapping-overrides";
import { NextRequest, NextResponse } from "next/server";

type OverrideRequest = {
  action?: unknown;
  cusip?: unknown;
  ticker?: unknown;
  symbol?: unknown;
  exchange?: unknown;
  limit?: unknown;
  limitPerCusip?: unknown;
  maxCusips?: unknown;
};

function parseLimit(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function assertAdmin(request: NextRequest) {
  const decoded = await getDecodedUserFromRequest(request);

  if (!decoded) {
    return {
      decoded: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!await isAdminUser(decoded)) {
    return {
      decoded: null,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { decoded, response: null };
}

export async function GET(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (admin.response) {
    return admin.response;
  }

  try {
    return NextResponse.json(await getCusipMappingGapsSummary({
      sampleLimit: parseLimit(request.nextUrl.searchParams.get("sampleLimit")),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load CUSIP mapping gaps.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await assertAdmin(request);
  if (admin.response) {
    return admin.response;
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as OverrideRequest;
    const action = readString(payload.action);

    if (action === "applyOverride") {
      const result = await applyCusipMappingOverride({
        cusip: readString(payload.cusip),
        limit: readNumber(payload.limit),
        updatedBy: admin.decoded.uid,
      });

      return NextResponse.json({
        ok: true,
        action,
        result,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === "applyMappedGaps") {
      const result = await applyMappedCusipOverrides({
        limitPerCusip: readNumber(payload.limitPerCusip),
        maxCusips: readNumber(payload.maxCusips),
        updatedBy: admin.decoded.uid,
      });

      return NextResponse.json({
        ok: true,
        action,
        result,
        timestamp: new Date().toISOString(),
      });
    }

    const result = await upsertCusipMappingOverride({
      cusip: readString(payload.cusip),
      ticker: readString(payload.ticker),
      symbol: readString(payload.symbol),
      exchange: readString(payload.exchange),
      updatedBy: admin.decoded.uid,
    });

    return NextResponse.json({
      ok: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save CUSIP mapping override.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
