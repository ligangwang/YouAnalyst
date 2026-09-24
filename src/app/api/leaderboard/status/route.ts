import { getAdminFirestore } from "@/lib/firebase/admin";
import { MIN_RANKED_ANALYSTS, rankingsOpen } from "@/lib/community";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CACHE_MS = 10 * 60 * 1000;
let cached: { rankedAnalysts: number; expires: number } | undefined;

// Counts analysts with at least one public ranked call (stats.totalCalls is kept by recomputeUserAnalytics).
async function rankedAnalystCount(): Promise<number> {
  if (cached && cached.expires > Date.now()) return cached.rankedAnalysts;
  const snapshot = await getAdminFirestore().collection("users").where("stats.totalCalls", ">", 0).count().get();
  const rankedAnalysts = snapshot.data().count;
  cached = { rankedAnalysts, expires: Date.now() + CACHE_MS };
  return rankedAnalysts;
}

export async function GET() {
  try {
    const rankedAnalysts = await rankedAnalystCount();
    return NextResponse.json(
      { rankedAnalysts, minimum: MIN_RANKED_ANALYSTS, open: rankingsOpen(rankedAnalysts) },
      { headers: { "cache-control": "public, max-age=300, s-maxage=600" } },
    );
  } catch {
    return NextResponse.json({ rankedAnalysts: null, minimum: MIN_RANKED_ANALYSTS, open: false }, { status: 503 });
  }
}
