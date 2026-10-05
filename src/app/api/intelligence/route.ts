import { loadIntelligenceSnapshot } from '@/lib/intelligence/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
import { parseCompanyTheme } from '@/lib/company-themes/model';
export async function GET(request:Request){
  try{return Response.json(await loadIntelligenceSnapshot(new Date(),parseCompanyTheme(new URL(request.url).searchParams.get('theme'))),{headers:{'Cache-Control':'no-store'}});}
  catch{return Response.json({error:'Investment intelligence is unavailable. Retry to reconnect.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
