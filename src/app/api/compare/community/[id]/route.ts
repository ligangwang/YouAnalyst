import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { readCommunityComparison } from "@/lib/compare-community-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getDecodedUserFromRequest(request);
  try {
    const post = await readCommunityComparison((await params).id, user?.uid);
    return NextResponse.json(post ?? { error: "Comparison not found" }, { status: post ? 200 : 404, headers });
  } catch { return NextResponse.json({ error: "Comparison temporarily unavailable" }, { status: 503, headers }); }
}
