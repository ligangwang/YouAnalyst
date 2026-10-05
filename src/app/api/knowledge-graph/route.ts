import { parseCompanyTheme } from '@/lib/company-themes/model';
import { loadThemeGraph } from '@/lib/company-themes/graph-service';
import { loadKnowledgeGraph } from "@/lib/knowledge-graph/service";
export const runtime = "nodejs";
export async function GET(request:Request) {
  try {
    return Response.json(await (parseCompanyTheme(new URL(request.url).searchParams.get('theme'))==='ai'?loadKnowledgeGraph():loadThemeGraph('robotics')), { headers: { "Cache-Control": "no-store", "X-Graph-Storage": "company_relationships" } });
  } catch {
    return Response.json({ error: "Knowledge graph unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
