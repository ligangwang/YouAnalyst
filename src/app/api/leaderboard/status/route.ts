import { getAdminFirestore } from "@/lib/firebase/admin";
import { MIN_RANKED_ANALYSTS, rankingsOpen } from "@/lib/community";
import { NextResponse } from "next/server";
import { changeCached } from '@/lib/change-cache';

export const dynamic = "force-dynamic";

// Counts analysts with at least one public ranked call (stats.totalCalls is kept by recomputeUserAnalytics).
async function rankedAnalystCount(): Promise<number> {
  const db=getAdminFirestore();
  return changeCached(db,'ranked-analysts',['users'],async()=>{
    const snapshot = await db.collection("users").where("stats.totalCalls", ">", 0).count().get();
    return snapshot.data().count;
  });
}

export async function GET() {
  try {
    const rankedAnalysts = await rankedAnalystCount();
    return NextResponse.json(
      { rankedAnalysts, minimum: MIN_RANKED_ANALYSTS, open: rankingsOpen(rankedAnalysts) },
      { headers: { "cache-control": "no-cache" } },
    );
  } catch {
    return NextResponse.json({ rankedAnalysts: null, minimum: MIN_RANKED_ANALYSTS, open: false }, { status: 503 });
  }
}
