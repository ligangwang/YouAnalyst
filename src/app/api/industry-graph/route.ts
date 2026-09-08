import { NextResponse } from "next/server";
import { loadIndustryGraph } from "@/lib/industry-graph/service";

export const runtime = "nodejs";
export async function GET() {
  try {
    return NextResponse.json(await loadIndustryGraph(), {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json({ error: "Filing relationships are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
