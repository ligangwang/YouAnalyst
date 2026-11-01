import {loadIntelligenceEnrichment} from '@/lib/intelligence/service';
import {loadThemeCatalog} from '@/lib/company-themes/catalog';
import {resolveCatalogTheme} from '@/lib/company-themes/catalog-model';
import {withCompanyPageReads} from '@/lib/local-cache/company-page-scope';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function POST(request:Request){
  let body:Record<string,unknown>;
  try{const text=await request.text();if(text.length>12_000)return Response.json({error:'Request too large'},{status:413,headers});body=JSON.parse(text);}
  catch{return Response.json({error:'Invalid request'},{status:400,headers});}
  const ids=(value:unknown,max:number):value is string[]=>Array.isArray(value)&&value.length<=max&&value.every(id=>typeof id==='string'&&id.length>0&&id.length<=240);
  if(!body||!['calendar','prices'].includes(String(body.kind))||!ids(body.eventIds,20)||!ids(body.companyIds,20)||typeof body.snapshotAt!=='string'||!Number.isFinite(Date.parse(body.snapshotAt)))return Response.json({error:'Invalid enrichment scope'},{status:400,headers});
  if(!body.eventIds.length&&(body.kind==='calendar'||!body.companyIds.length))return Response.json({snapshotAt:body.snapshotAt},{headers});
  try{
    const theme=resolveCatalogTheme(await loadThemeCatalog(),typeof body.theme==='string'?body.theme:null);
    if(!theme)return Response.json({error:'Unknown theme'},{status:404,headers});
    const started=performance.now();
    const data=await withCompanyPageReads(()=>loadIntelligenceEnrichment(theme,body.eventIds as string[],body.companyIds as string[],body.kind as 'calendar'|'prices',body.snapshotAt as string));
    console.info(JSON.stringify({event:'intelligence_stage_duration',theme,stage:body.kind,durationMs:Math.round(performance.now()-started),events:body.eventIds.length,companies:body.companyIds.length}));
    return Response.json({...data,snapshotAt:body.snapshotAt},{headers});
  }catch{return Response.json({error:'Details unavailable. Retry.'},{status:503,headers});}
}
