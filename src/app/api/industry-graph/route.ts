import { NextResponse } from "next/server";
import { loadIndustryGraph } from "@/lib/industry-graph/service";
import { readMapOptions } from "@/lib/industry-graph/directory";

export const runtime = "nodejs";
export async function GET(request: Request) {
  let options;
  try { options = readMapOptions(new URL(request.url).searchParams); }
  catch { return NextResponse.json({ error: "Invalid company or page cursor." }, { status: 400 }); }
  try {
    return NextResponse.json(await loadIndustryGraph(options), {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json({ error: "Filing relationships are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
