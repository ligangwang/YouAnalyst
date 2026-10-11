import { loadCompanyIntelligenceSnapshot,loadIntelligenceUniverse } from '@/lib/intelligence/service';
import { after } from 'next/server';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
export const runtime='nodejs';
export const dynamic='force-dynamic';
import { parseCompanyTheme } from '@/lib/company-themes/model';
const compress=promisify(gzip);
export async function GET(request:Request){
  const params=new URL(request.url).searchParams;
  try{
    const snapshot=await (params.get('section')==='universe'?loadIntelligenceUniverse(new Date(),parseCompanyTheme(params.get('theme'))):loadCompanyIntelligenceSnapshot(new Date(),parseCompanyTheme(params.get('theme')),params.get('company')??'',params.get('q')??'',params.get('region')??'',after));
    const body=JSON.stringify(snapshot);
    const headers:Record<string,string>={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Vary':'Accept-Encoding'};
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
