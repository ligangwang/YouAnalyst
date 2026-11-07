import {latestSharedCompareDate} from '@/lib/compare-latest';
import { NextRequest } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {compareSymbol, type CompareConfig } from "@/lib/compare";
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
  if(params.get('latest')==='1') {
    if(config.symbols.length<1||config.symbols.length>10||config.symbols.some(symbol=>!compareSymbol(symbol)))return Response.json({error:'Choose between 1 and 10 valid stock tickers.'},{status:400});
    try { return Response.json({dates:[await latestSharedCompareDate(getAdminFirestore(),config.symbols)]},{headers:{'Cache-Control':'no-store'}}); }
    catch { return Response.json({error:'Unable to find a recent shared trading date.'},{status:503}); }
  }
  const error = validatePlaybackConfig(config);
  if (error) return Response.json({ error }, { status: 400 });
  try {
    return Response.json(await loadStockComparison(getAdminFirestore(), config), { headers: { "Cache-Control": "no-cache" } });
  } catch (error) {
    return comparisonErrorResponse(error);
  }
}
