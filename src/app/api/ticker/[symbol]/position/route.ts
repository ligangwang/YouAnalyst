import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { normalizeTicker } from "@/lib/predictions/types";
import { NextRequest, NextResponse } from "next/server";

/** Retired uncited shortcut: creating human calls goes through /api/posts. */
export async function POST(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  const decoded = await getDecodedUserFromRequest(request);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { symbol } = await context.params;
  return NextResponse.json({
    error: "Publish an evidence-backed view using the publish form.",
    publishUrl: `/predictions/new?${new URLSearchParams({ ticker: normalizeTicker(symbol) })}`,
  }, { status: 410 });
}
