// Retired: public company relationships are served only by the knowledge graph.
export function GET() {
  return Response.json({ error: "The industry graph has been retired.", replacement: "/api/knowledge-graph" }, { status: 410 });
}
