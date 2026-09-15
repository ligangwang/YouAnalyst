import { researchRequest } from "@/lib/research/http";
export const runtime = "nodejs";
export async function POST(request: Request) { return researchRequest(request, "publish"); }
