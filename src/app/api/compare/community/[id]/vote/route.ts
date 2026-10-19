import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { voteOnComparison } from "@/lib/compare-community-service";
import { comparisonActionFailure } from "@/lib/compare-community";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to vote" }, { status: 401, headers });
  try { return NextResponse.json(await voteOnComparison((await params).id, user.uid, (await request.json()).value), { headers }); }
  catch (error) { const failure = comparisonActionFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status, headers }); }
}
