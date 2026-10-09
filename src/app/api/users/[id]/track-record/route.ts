import { getAdminFirestore } from "@/lib/firebase/admin";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { computeTrackRecord, TRACK_RECORD_BENCHMARK, trackRecordDates, type TrackRecordRow } from "@/lib/predictions/track-record";
import { NextRequest, NextResponse } from "next/server";

/** An analyst's public track record against the benchmark. Private profiles are visible only to their owner. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = getAdminFirestore();
  try {
    const [decoded, profile] = await Promise.all([getDecodedUserFromRequest(request), db.collection("users").doc(id).get()]);
    if (profile.get("settings.isPublic") === false && decoded?.uid !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Single-field equality query: no composite index. Visibility and status are filtered in computeTrackRecord.
    const snapshot = await db.collection("predictions").where("userId", "==", id).limit(1000).get();
    const rows: TrackRecordRow[] = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    const dates = trackRecordDates(rows);
    const closes = new Map<string, number>();
    for (let i = 0; i < dates.length; i += 200) {
      const docs = await db.getAll(...dates.slice(i, i + 200).map(date => db.collection("eod_prices").doc(`US_${TRACK_RECORD_BENCHMARK}_${date}`)));
      for (const doc of docs) {
        const close = doc.get("close"), tradingDate = doc.get("tradingDate");
        if (doc.exists && typeof close === "number" && close > 0 && typeof tradingDate === "string") closes.set(tradingDate, close);
      }
    }
    return NextResponse.json(computeTrackRecord(rows, closes), { headers: { "Cache-Control": "private, max-age=60" } });
  } catch {
    return NextResponse.json({ error: "Track record unavailable" }, { status: 500 });
  }
}
