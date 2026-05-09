import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { getCusipMappingGapsSummary } from "@/lib/securities/cusip-mapping-gaps";
import { NextRequest, NextResponse } from "next/server";

function parseLimit(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const decoded = await getDecodedUserFromRequest(request);

  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isAdminUser(decoded)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
