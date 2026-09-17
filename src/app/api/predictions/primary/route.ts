import { NextRequest, NextResponse } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { canonicalPredictionStatus } from "@/lib/predictions/types";

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
    const db = getAdminFirestore();
    await db.runTransaction(async tx => {
      const [prediction, profile] = await Promise.all([tx.get(db.collection("predictions").doc(predictionId)), tx.get(db.collection("users").doc(user.uid))]);
      if (!profile.exists || !prediction.exists || prediction.get("userId") !== user.uid || !["CREATED", "OPEN"].includes(canonicalPredictionStatus(prediction.get("status")) ?? "")) throw new Error("Choose your own active prediction");
      tx.update(profile.ref, new FieldPath("publishingPrimaryPredictions", prediction.get("ticker")), predictionId, "updatedAt", new Date().toISOString());
    });
    return NextResponse.json({ updated: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to select prediction" }, { status: 400 }); }
}
