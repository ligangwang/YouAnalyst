import { NextRequest } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { type CompareConfig } from "@/lib/compare";
import { validatePlaybackConfig } from "@/lib/ui/compare-range";
import { loadStockComparison } from "@/lib/compare-service";
import { comparisonErrorResponse } from "@/lib/compare-error";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const config: CompareConfig = {
    symbols: [...new Set((params.get("symbols") ?? "").split(",").map(s => s.trim().toUpperCase()))],
    start: params.get("start") ?? "", end: params.get("end") ?? "", style: "line",
  };
  const error = validatePlaybackConfig(config);
  if (error) return Response.json({ error }, { status: 400 });
  try {
    return Response.json(await loadStockComparison(getAdminFirestore(), config), { headers: { "Cache-Control": "no-cache" } });
  } catch (error) {
    return comparisonErrorResponse(error);
  }
}
