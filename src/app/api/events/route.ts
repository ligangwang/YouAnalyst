import { NextRequest, NextResponse } from "next/server";
import { decodeEventCursor, listPublicEvents } from "@/lib/events/service";
import { EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SIZE } from "@/lib/events/model";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit === null ? EVENT_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE_SIZE) return NextResponse.json({ error: `limit must be between 1 and ${MAX_EVENT_PAGE_SIZE}` }, { status: 400 });
  let cursor;
  try {
    const rawCursor = request.nextUrl.searchParams.get("cursor");
    cursor = rawCursor === null ? undefined : decodeEventCursor(rawCursor);
  } catch { return NextResponse.json({ error: "Invalid event cursor" }, { status: 400 }); }
  try {
    return NextResponse.json(await listPublicEvents({ limit, cursor }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Events are temporarily unavailable. Please retry." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
