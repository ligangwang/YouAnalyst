import { NextRequest, NextResponse } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { companyCallsForViewer } from "@/lib/predictions/company-calls";

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
  const user = await getDecodedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const ticker = (await context.params).symbol.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers });
  try {
    const db = getAdminFirestore();
    const [predictions, watchlists] = await Promise.all([
      db.collection("predictions").where("userId", "==", user.uid).where("ticker", "==", ticker).get(),
      db.collection("watchlists").where("userId", "==", user.uid).get(),
    ]);
    return NextResponse.json({ items: companyCallsForViewer(user.uid, ticker,
      predictions.docs.map(doc => ({ id: doc.id, data: doc.data() })),
      watchlists.docs.map(doc => ({ id: doc.id, data: doc.data() }))) }, { headers });
  } catch {
    return NextResponse.json({ error: "Unable to load your calls. Please retry." }, { status: 503, headers });
  }
}
