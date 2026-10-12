import { FieldPath } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { DEFAULT_TIMELINE_RANGE, mapTimelinePrice, TIMELINE_RANGES, timelineWindow, type TimelineRange } from "@/lib/ui/company-timeline";
import { marketDate, predictionInstrument } from "@/lib/predictions/instrument";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("company") ?? "";
  const days = Number(request.nextUrl.searchParams.get("days") ?? DEFAULT_TIMELINE_RANGE);
  const indicators = request.nextUrl.searchParams.get('indicators') === '1';
  if (!/^(US:[A-Z0-9][A-Z0-9.-]{0,11}|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(companyId) || !TIMELINE_RANGES.includes(days as TimelineRange)) {
    return Response.json({ error: "Invalid company or timeline range" }, { status: 400 });
  }
  const instrument = companyId.startsWith("ORG:") ? null : predictionInstrument(companyId.replace(/^US:/, ""));
  const window = timelineWindow(days as TimelineRange, instrument ? marketDate(instrument.market) : undefined);
  const base = { companyId, ...window, currency: instrument?.currency ?? null };
  const historyStart = indicators ? new Date(Date.parse(window.start)-180*86_400_000).toISOString().slice(0,10) : window.start;
  if (!instrument) return Response.json({ ...base, prices: [], available: true });
  try {
    // Existing document IDs are market_ticker_date. A document-ID range needs no new composite index.
    const prefix = `${instrument.market}_${instrument.ticker}_`;
    const snapshot = await getAdminFirestore().collection("eod_prices")
      .where(FieldPath.documentId(), ">=", prefix + historyStart)
      .where(FieldPath.documentId(), "<=", prefix + window.end)
      .orderBy(FieldPath.documentId()).limit(1900).get();
    const prices = snapshot.docs.flatMap(doc => {
      const price = mapTimelinePrice(doc.data(), instrument.ticker, instrument.market);
      return price && price.date >= historyStart && price.date <= window.end ? [price] : [];
    }).sort((a, b) => a.date.localeCompare(b.date));
    return Response.json({ ...base, prices:prices.filter(price=>price.date>=window.start), ...(indicators?{warmupPrices:prices.filter(price=>price.date<window.start)}:{}), available: true }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    return Response.json({ ...base, prices: [], available: false }, { status: 503 });
  }
}
