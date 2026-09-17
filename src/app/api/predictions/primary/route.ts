import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { choosePrimaryPrediction } from "@/lib/predictions/primary";

export async function GET(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await getAdminFirestore().collection("users").doc(user.uid).get();
  return NextResponse.json({ primaryPredictions: profile.get("publishingPrimaryPredictions") ?? {} }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { predictionId } = await request.json();
    if (typeof predictionId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(predictionId)) throw new Error("Invalid prediction");
    await choosePrimaryPrediction(getAdminFirestore(), user.uid, predictionId);
    return NextResponse.json({ updated: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to select prediction" }, { status: 400 }); }
}
