import { loadKnowledgeGraph } from "@/lib/knowledge-graph/service";
export const runtime = "nodejs";
export async function GET() {
  try {
    return Response.json(await loadKnowledgeGraph(), { headers: { "Cache-Control": "public, max-age=60, s-maxage=300", "X-Graph-Storage": "company_relationships" } });
  } catch {
    return Response.json({ error: "Knowledge graph unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
