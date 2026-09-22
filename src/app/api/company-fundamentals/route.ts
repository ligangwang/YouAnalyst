import { getAdminFirestore } from '@/lib/firebase/admin';
import { requestCompanyFundamentals, validFundamentalsTicker } from '@/lib/fundamentals/service';
import { maintenanceError } from '@/lib/maintenance-log';

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get('ticker') ?? '';
  if (!validFundamentalsTicker(ticker)) return Response.json({error:'Invalid ticker'}, {status:400});
  try {
    // Serve the existing cache; missing/stale records join the daily worker queue.
    // Visitor requests never call SEC.
    const data = await requestCompanyFundamentals(ticker, getAdminFirestore());
    return Response.json({data:data ? {metrics:data.metrics, marketCap:data.marketCap, report:data.report, stale:data.stale} : null},
      {headers:{'Cache-Control':'public, max-age=60, s-maxage=300'}});
  } catch (error) {
    console.error(JSON.stringify({severity:'ERROR',message:'fundamentals: graph_card_failed',ticker,error:maintenanceError(error)}));
    return Response.json({error:'Fundamentals unavailable'}, {status:503});
  }
}
