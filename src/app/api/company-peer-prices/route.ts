import {loadPeerComparison} from '@/lib/peer-comparison/service';
import {normalizePriceDemand} from '@/lib/peer-comparison/price-demand';
export const runtime='nodejs';
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,company=params.get('company')??'',ids=params.getAll('peer');
 const demand=normalizePriceDemand(company,ids);
 if(!demand)return Response.json({error:'Invalid visible peers'},{status:400});
 const data=await loadPeerComparison(company,{priceIds:demand,signal:request.signal});
 if(!data)return Response.json({error:'Peer prices unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
 return Response.json({panel:data.panels.find(panel=>panel.key==='fiveDayReturn')??null},{headers:{'Cache-Control':'no-store'}});
}
