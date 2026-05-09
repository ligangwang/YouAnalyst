import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { previewFollowedInstitutionDigest } from "@/lib/securities/institution-follows";
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
    const preview = await previewFollowedInstitutionDigest(
      decoded.uid,
      readLimit(request.nextUrl.searchParams.get("limit")),
    );
    if (!preview) {
      return NextResponse.json({ error: "User profile not found" }, { status: 404 });
    }

    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to preview institution digest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
