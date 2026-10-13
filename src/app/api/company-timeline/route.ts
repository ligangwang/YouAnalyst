import { FieldPath } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { DEFAULT_TIMELINE_RANGE, mapTimelinePrice, TIMELINE_RANGES, TIMELINE_INTERVALS, resolvedTimelineInterval, timelineIndicatorHistoryStart, timelineWindow, timelinePriceBars, type TimelineRange, type TimelineIntervalChoice } from "@/lib/ui/company-timeline";
import {cachedTimelinePrices} from '@/lib/ui/timeline-cache';
import { marketDate, predictionInstrument } from "@/lib/predictions/instrument";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get("company") ?? "";
  const requestedRange=request.nextUrl.searchParams.get('days');
  const days = requestedRange==='ytd'?'ytd':Number(requestedRange??DEFAULT_TIMELINE_RANGE);
  const indicators = request.nextUrl.searchParams.get('indicators') === '1';
  const requestedInterval=request.nextUrl.searchParams.get('interval')??'auto';
  if(requestedInterval!=='auto'&&!TIMELINE_INTERVALS.includes(requestedInterval as typeof TIMELINE_INTERVALS[number]))return Response.json({error:'Invalid chart interval'},{status:400});
  const requestedPeriod=Number(request.nextUrl.searchParams.get('maPeriod')??60);
  if(!Number.isInteger(requestedPeriod)||requestedPeriod<1||requestedPeriod>500)return Response.json({error:'Invalid moving-average period'},{status:400});
  if (!/^(US:[A-Z0-9][A-Z0-9.-]{0,11}|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(companyId) || !TIMELINE_RANGES.includes(days as TimelineRange)) {
    return Response.json({ error: "Invalid company or timeline range" }, { status: 400 });
  }
  const instrument = companyId.startsWith("ORG:") ? null : predictionInstrument(companyId.replace(/^US:/, ""));
  const window = timelineWindow(days as TimelineRange, instrument ? marketDate(instrument.market) : undefined);
  const interval=resolvedTimelineInterval(days as TimelineRange,requestedInterval as TimelineIntervalChoice);
  const base = { companyId, ...window, currency: instrument?.currency ?? null,interval };
  const historyStart = indicators ? timelineIndicatorHistoryStart(window.start,interval,requestedPeriod) : window.start;
  if (!instrument) return Response.json({ ...base, prices: [], available: true });
  try {
    // Existing document IDs are market_ticker_date. A document-ID range needs no new composite index.
    const prefix = `${instrument.market}_${instrument.ticker}_`;
    const collection=getAdminFirestore().collection('eod_prices');
    const latest=await collection.where(FieldPath.documentId(),'>=',prefix).where(FieldPath.documentId(),'<=',prefix+window.end).orderBy(FieldPath.documentId(),'desc').limit(1).get();
    const revision=latest.docs[0];
    const cacheKey=JSON.stringify([companyId,days,indicators,requestedPeriod,window.end,base.interval,revision?.id,revision?.updateTime.toMillis()]);
    const result=await cachedTimelinePrices(cacheKey,async()=>{
    const snapshot = await getAdminFirestore().collection("eod_prices")
      .where(FieldPath.documentId(), ">=", prefix + historyStart)
      .where(FieldPath.documentId(), "<=", prefix + window.end)
      .orderBy(FieldPath.documentId(),'desc').limit(6000).get();
    const prices = snapshot.docs.flatMap(doc => {
      const price = mapTimelinePrice(doc.data(), instrument.ticker, instrument.market);
      return price && price.date >= historyStart && price.date <= window.end ? [price] : [];
    }).sort((a, b) => a.date.localeCompare(b.date));
    const bars=timelinePriceBars(prices,window.start,interval);
    return {...base,prices:bars.prices,...(indicators?{warmupPrices:bars.warmupPrices}:{}),available:true};
    });
    return Response.json(result,{headers:{'Cache-Control':'public, max-age=60'}});
  } catch {
    return Response.json({ ...base, prices: [], available: false }, { status: 503 });
  }
}
