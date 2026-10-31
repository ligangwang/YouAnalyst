import {loadCompanyPageGraph} from '@/lib/company-research-service';

export const runtime='nodejs';
export async function GET(request:Request){
 const id=new URL(request.url).searchParams.get('company')??'';
 const headers={'Cache-Control':'no-store'};
 if(!/^(?:US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(id))
  return Response.json({error:'Invalid company'},{status:400,headers});
 try{return Response.json(await loadCompanyPageGraph(id),{headers});}
 catch{return Response.json({error:'Company relationships unavailable'},{status:503,headers});}
}
