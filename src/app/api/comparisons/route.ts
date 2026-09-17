import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { getWatchlistDetail } from "@/lib/watchlists/service";
export async function GET(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  const groups = await getAdminFirestore().collection("watchlists").where("kind", "==", "COMPARISON").get();
  const items = [];
  for (const group of groups.docs) {
    const owner = await getAdminFirestore().collection("users").doc(group.get("userId")).get();
    if (user?.uid !== group.get("userId") && (!owner.exists || owner.get("settings.isPublic") === false)) continue;
    const detail = await getWatchlistDetail(group.id, { viewerUserId: user?.uid });
    if (detail) items.push({ id: detail.id, name: detail.name, predictions: [...detail.livePredictions, ...detail.settledPredictions] });
  }
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
