import { getAdminFirestore } from '@/lib/firebase/admin';
import { readCompanyFundamentals, validFundamentalsTicker } from '@/lib/fundamentals/service';
import { maintenanceError } from '@/lib/maintenance-log';
import { CN_COMPANY_ID } from '@/lib/knowledge-graph/cn-companies';
import { readCnFundamentals } from '@/lib/fundamentals/cn-service';

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get('ticker') ?? '';
  if (!validFundamentalsTicker(ticker)&&!CN_COMPANY_ID.test(ticker)) return Response.json({error:'Invalid ticker'}, {status:400});
  try {
    if(CN_COMPANY_ID.test(ticker))return Response.json({data:await readCnFundamentals(ticker,getAdminFirestore())},{headers:{'Cache-Control':'no-cache'}});
    // Serve stored data only; visitors cannot enqueue SEC refreshes.
    // Visitor requests never call SEC.
    const data = await readCompanyFundamentals(ticker, getAdminFirestore());
    if(new URL(request.url).searchParams.get('view')==='company')return Response.json({data},{headers:{'Cache-Control':'no-store'}});
    return Response.json({data:data ? {metrics:data.metrics, marketCap:data.marketCap, report:data.report, stale:data.stale} : null},
      {headers:{'Cache-Control':'no-cache'}});
  } catch (error) {
    console.error(JSON.stringify({severity:'ERROR',message:'fundamentals: graph_card_failed',ticker,error:maintenanceError(error)}));
    return Response.json({error:'Fundamentals unavailable'}, {status:503});
  }
}
