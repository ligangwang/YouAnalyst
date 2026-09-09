import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getOrCreateDefaultWatchlistForUser } from "@/lib/watchlists/service";

export async function POST(request: NextRequest) {
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = await getOrCreateDefaultWatchlistForUser(user.uid);
    return NextResponse.json({ id }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to prepare your watchlist. Please retry." }, { status: 503 });
  }
}
