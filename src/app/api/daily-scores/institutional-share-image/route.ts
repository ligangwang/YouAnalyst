import { NextRequest } from "next/server";
import { institutionalMoveFromShareParams } from "@/lib/daily-scores/institutional-share-snapshot";
import { createDailyInstitutionalMoveShareImage } from "@/lib/daily-scores/share-card";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  const kind = params.get("kind") ?? "";
  const ticker = params.get("ticker") ?? "";
  const snapshot = institutionalMoveFromShareParams(params, ticker);

  return createDailyInstitutionalMoveShareImage(date, kind, ticker, snapshot);
}
