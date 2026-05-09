import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import {
  countUnreadInstitutionDigestRuns,
  listInstitutionDigestRuns,
} from "@/lib/securities/institution-follows";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function readLimit(value: string | null): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const decoded = await getDecodedUserFromRequest(request);
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [items, unreadCount] = await Promise.all([
      listInstitutionDigestRuns(
        decoded.uid,
        readLimit(request.nextUrl.searchParams.get("limit")),
      ),
      countUnreadInstitutionDigestRuns(decoded.uid),
    ]);

    return NextResponse.json({ items, unreadCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load institution digests";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
