import { loadCompanyIntelligenceSnapshot } from '@/lib/intelligence/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
import { parseCompanyTheme } from '@/lib/company-themes/model';
export async function GET(request:Request){
  const params=new URL(request.url).searchParams;
  try{return Response.json(await loadCompanyIntelligenceSnapshot(new Date(),parseCompanyTheme(params.get('theme')),params.get('company')??''),{headers:{'Cache-Control':'no-store'}});}
  catch{return Response.json({error:'Investment intelligence is unavailable. Retry to reconnect.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
