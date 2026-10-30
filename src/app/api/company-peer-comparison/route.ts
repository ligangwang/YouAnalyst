import {loadPeerComparison} from '@/lib/peer-comparison/service';
export const runtime='nodejs';
export async function GET(request:Request){
 const company=new URL(request.url).searchParams.get('company')??'';
 const headers={'Cache-Control':'no-store'};
 if(!/^(US:[A-Z0-9][A-Z0-9.-]{0,11}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(company))return Response.json({error:'Invalid company'},{status:400,headers});
 try {
  const data=await loadPeerComparison(company,{signal:request.signal,strict:true});
  return Response.json({data},{headers});
 }catch{return Response.json({error:'Peer comparison unavailable'},{status:503,headers});}
}
