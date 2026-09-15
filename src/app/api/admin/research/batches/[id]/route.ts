import { researchRequest } from "@/lib/research/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return researchRequest(request, "get", (await context.params).id); }
