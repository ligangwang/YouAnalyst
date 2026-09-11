import { NextRequest, NextResponse } from "next/server";
import { loadKnowledgeGraph } from "@/lib/knowledge-graph/service";
import { graphChinaCompanies } from "@/lib/knowledge-graph/china-companies";
import { validChinaId } from "@/lib/industry-research/china";

export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("cursor") ?? "";
  if (cursor && !validChinaId(cursor)) return NextResponse.json({ error: "Invalid company cursor." }, { status: 400 });
  try {
    const companies = graphChinaCompanies(await loadKnowledgeGraph()).filter(c => !cursor || c.id > cursor);
    const items = companies.slice(0, 100);
    return NextResponse.json({ items, nextCursor: companies.length > 100 ? items.at(-1)!.id : null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Company directory is temporarily unavailable." }, { status: 503 });
  }
}
