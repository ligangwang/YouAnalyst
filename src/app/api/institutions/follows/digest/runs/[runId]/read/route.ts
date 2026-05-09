import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { markInstitutionDigestRunRead } from "@/lib/securities/institution-follows";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const decoded = await getDecodedUserFromRequest(request);
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await context.params;
  if (!runId) {
    return NextResponse.json({ error: "Missing digest run id" }, { status: 400 });
  }

  try {
    const result = await markInstitutionDigestRunRead(decoded.uid, runId);
    if (!result) {
      return NextResponse.json({ error: "Digest run not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "Failed to mark digest as read";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
