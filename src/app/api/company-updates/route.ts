import { curatedEvents } from "@/lib/knowledge-graph/curated-events";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { readCompanyFollows } from "@/lib/company-follows-store";
import { loadKnowledgeGraph } from "@/lib/knowledge-graph/service";
import { companyUpdates } from "@/lib/knowledge-graph/company-updates";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
  try {
    const user = await getDecodedUserFromRequest(request);
    if (!user) return Response.json({ error: "Sign in required" }, { status: 401, headers });
    const ids = await readCompanyFollows(user.uid);
    if (!ids.length) return Response.json({ items: [] }, { headers });
    const graph = await loadKnowledgeGraph();
    return Response.json({ items: companyUpdates(graph, ids, curatedEvents) }, { headers });
  } catch { return Response.json({ error: "Updates unavailable" }, { status: 503, headers }); }
}
