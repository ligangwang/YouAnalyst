import {getAdminFirestore} from '@/lib/firebase/admin';
import {companyInstruments, resolveInstrumentContext} from '@/lib/instruments/service';

export async function GET(request:Request) {
  const params=new URL(request.url).searchParams;
  const id=params.get('id'),companyId=params.get('companyId');
  if((!id&&!companyId)||(id&&companyId)||[id,companyId].some(v=>v!==null&&(!v||v.length>160||v.includes('/'))))return Response.json({error:'Provide one instrument or company ID'},{status:400});
  try {
    const db=getAdminFirestore();
    if(companyId)return Response.json({instruments:await companyInstruments(db,companyId)},{headers:{'Cache-Control':'no-store'}});
    const context=await resolveInstrumentContext(db,id!);
    if(!context)return Response.json({error:'Instrument not found'},{status:404});
    // Return public identity only, never the entire company document.
    return Response.json({instrument:context.instrument,company:{id:context.company.id,name:context.company.data.name},historyKey:context.historyKey},{headers:{'Cache-Control':'no-store'}});
  }catch(error){console.error('Instrument lookup failed',error);return Response.json({error:'Instrument lookup unavailable'},{status:503});}
}
