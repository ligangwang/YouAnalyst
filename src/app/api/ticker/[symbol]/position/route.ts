import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { createPredictionForUser } from "@/lib/predictions/service";
import { isPredictionDirection, normalizeTicker } from "@/lib/predictions/types";
import { getOrCreatePublicWatchlistForUser } from "@/lib/watchlists/service";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const decoded = await getDecodedUserFromRequest(request);
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { symbol } = await context.params;
    const ticker = normalizeTicker(symbol);
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const direction = payload.direction;
    if (!ticker || !isPredictionDirection(direction)) {
      return NextResponse.json({ error: "A valid ticker and direction are required." }, { status: 400 });
    }

    const activeSnapshot = await getAdminFirestore()
      .collection("predictions")
      .where("userId", "==", decoded.uid)
      .where("ticker", "==", ticker)
      .get();
    const existing = activeSnapshot.docs.find((doc) => {
      const status = doc.get("status");
      return doc.get("visibility") === "PUBLIC" &&
        (status === "CREATED" || status === "OPEN" || status === "OPENING" || status === "CLOSING");
    });
    if (existing) {
      return NextResponse.json({ id: existing.id, existing: true });
    }

    const watchlistId = await getOrCreatePublicWatchlistForUser(decoded.uid);
    const created = await createPredictionForUser({
      ticker,
      direction,
      watchlistId,
      thesisTitle: "",
      thesis: "",
      timeHorizon: null,
      visibility: "PUBLIC",
    }, {
      uid: decoded.uid,
      displayName: decoded.name,
      photoURL: decoded.picture,
    });

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record position.";
    const status = /already exists|duplicate|limit reached/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
