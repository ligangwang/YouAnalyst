import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { listCommunityComparisons, publishComparison } from "@/lib/compare-community-service";
import { comparisonActionFailure, validateComparisonSubmission } from "@/lib/compare-community";
import { loadStockComparison } from "@/lib/compare-service";
import { getAdminFirestore } from "@/lib/firebase/admin";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  try { return NextResponse.json(await listCommunityComparisons(request.nextUrl.searchParams.get("cursor"), user?.uid), { headers }); }
  catch { return NextResponse.json({ error: "Community comparisons are temporarily unavailable. Please retry." }, { status: 503, headers }); }
}
export async function POST(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to publish a comparison" }, { status: 401, headers });
  let input;
  try { input = validateComparisonSubmission(await request.json()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid comparison" }, { status: 400, headers }); }
  try { await loadStockComparison(getAdminFirestore(), input.comparison.config); }
  catch { return NextResponse.json({ error: "This comparison could not be replayed. Check its stocks and dates, then retry." }, { status: 503, headers }); }
  try { return NextResponse.json(await publishComparison(input, { uid: user.uid, displayName: user.name }), { status: 201, headers }); }
  catch (error) { const failure = comparisonActionFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status, headers }); }
}
