import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { addComparisonComment, listComparisonComments } from "@/lib/compare-community-service";
import { comparisonActionFailure } from "@/lib/compare-community";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await listComparisonComments((await params).id, request.nextUrl.searchParams.get("cursor")), { headers }); }
  catch (error) { const missing = error instanceof Error && error.message === "Comparison not found"; return NextResponse.json({ error: missing ? "Comparison not found" : "Comments temporarily unavailable" }, { status: missing ? 404 : 503, headers }); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to comment" }, { status: 401, headers });
  try { return NextResponse.json(await addComparisonComment((await params).id, { uid: user.uid, displayName: user.name }, await request.json()), { status: 201, headers }); }
  catch (error) { const failure = comparisonActionFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status, headers }); }
}
