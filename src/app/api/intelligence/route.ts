import { loadCompanyIntelligenceSnapshot,loadIntelligenceUniverse } from '@/lib/intelligence/service';
import { after } from 'next/server';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
export const runtime='nodejs';
export const dynamic='force-dynamic';
import {loadThemeCatalog} from '@/lib/company-themes/catalog';
import {resolveCatalogTheme} from '@/lib/company-themes/catalog-model';
import {withCompanyPageReads} from '@/lib/local-cache/company-page-scope';
const compress=promisify(gzip);
export async function GET(request:Request){
  const params=new URL(request.url).searchParams;
  const before=params.get('before');
  if(before&&!/^\d{4}-\d{2}-\d{2}$/.test(before))return Response.json({error:'Invalid day cursor'},{status:400});
  try{
    const theme=resolveCatalogTheme(await loadThemeCatalog(),params.get('theme'));
    if(!theme)return Response.json({error:'Unknown or unpublished theme'},{status:404,headers:{'Cache-Control':'no-store'}});
    // Complete published graphs need targeted members and valuations, not the
    // entire market's company/fundamentals snapshot files on a fresh instance.
    const snapshot=await withCompanyPageReads(()=>params.get('section')==='universe'?loadIntelligenceUniverse(new Date(),theme):loadCompanyIntelligenceSnapshot(new Date(),theme,params.get('company')??'',params.get('q')??'',params.get('region')??'',after,params.get('before')??undefined,true));
    const body=JSON.stringify(snapshot);
    const headers:Record<string,string>={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Accept-Encoding'};
    const etag=`W/"${createHash('sha256').update(body).digest('hex')}"`;
    headers.ETag=etag;
    if((request.headers.get('if-none-match')??'').split(',').some(value=>value.trim()===etag))return new Response(null,{status:304,headers});
    const acceptsGzip=(request.headers.get('accept-encoding')??'').split(',').some(value=>{
      const [encoding,...parameters]=value.trim().toLowerCase().split(';');
      const quality=parameters.find(parameter=>parameter.trim().startsWith('q='));
      return encoding==='gzip'&&(!quality||Number(quality.trim().slice(2))>0);
    });
    if(acceptsGzip&&body.length>1024){
      headers['Content-Encoding']='gzip';
      return new Response(new Uint8Array(await compress(body)),{headers});
    }
    return new Response(body,{headers});
  }
  catch{return Response.json({error:'Investment intelligence is unavailable. Retry to reconnect.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
