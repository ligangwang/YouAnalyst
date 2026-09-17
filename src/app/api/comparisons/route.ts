import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { getWatchlistDetail } from "@/lib/watchlists/service";
export async function GET(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  const ownerId = request.nextUrl.searchParams.get("userId");
  const watchlists = getAdminFirestore().collection("watchlists");
  const groups = await (ownerId ? watchlists.where("userId", "==", ownerId) : watchlists.where("kind", "==", "COMPARISON")).get();
  const items = [];
  for (const group of groups.docs) {
    if (group.get("kind") !== "COMPARISON") continue;
    const owner = await getAdminFirestore().collection("users").doc(group.get("userId")).get();
    if (user?.uid !== group.get("userId") && (!owner.exists || owner.get("settings.isPublic") === false)) continue;
    const detail = await getWatchlistDetail(group.id, { viewerUserId: user?.uid });
    if (detail) {
      const ids = group.get("predictionIds") as string[] | undefined;
      const predictions = [...detail.livePredictions, ...detail.settledPredictions].filter(p => ids?.includes(p.id)).sort((a, b) => a.ticker.localeCompare(b.ticker));
      if (ids && ids.length >= 2 && predictions.length === ids.length && predictions[0].entryDate && predictions.every(p => p.entryDate === predictions[0].entryDate)) items.push({ id: detail.id, name: detail.name, predictions });
    }
  }
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
