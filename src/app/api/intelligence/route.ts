import { loadIntelligenceSnapshot } from '@/lib/intelligence/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
  try{return Response.json(await loadIntelligenceSnapshot(),{headers:{'Cache-Control':'no-store'}});}
  catch{return Response.json({error:'Investment intelligence is unavailable. Retry to reconnect.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
