import { NextRequest, NextResponse } from "next/server";
import { getInstitutionalDiscoverySummary } from "@/lib/securities/institutional-data";

export const dynamic = "force-dynamic";

function readLimit(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const summary = await getInstitutionalDiscoverySummary({
      managerLimit: readLimit(request.nextUrl.searchParams.get("managerLimit")),
      activityLimit: readLimit(request.nextUrl.searchParams.get("activityLimit")),
      tickerLimit: readLimit(request.nextUrl.searchParams.get("tickerLimit")),
    });

    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load institutional discovery";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
