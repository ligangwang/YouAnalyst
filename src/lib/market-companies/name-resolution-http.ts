import type { Firestore } from 'firebase-admin/firestore';
import { getNameResolution,listNameResolutions,searchIdentityCandidates,reviewCompanyIdentity,parseIdentityAction,NameResolutionError } from './name-resolution';
type Dependencies={authenticate:(request:Request)=>Promise<{uid:string;admin:boolean}|null>;db:()=>Firestore};
export async function nameResolutionResponse(request:Request,deps:Dependencies){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const actor=await deps.authenticate(request);
  if(!actor)return Response.json({error:'Sign in to review company identities'},{status:401,headers});
  if(request.method==='GET'){
   const url=new URL(request.url);
   if(url.searchParams.has('q'))return Response.json({...await searchIdentityCandidates(deps.db(),url.searchParams.get('q')??''),admin:actor.admin},{headers});
   if(url.searchParams.has('event'))return Response.json({...await getNameResolution(deps.db(),url.searchParams.get('event')??'',actor.uid,actor.admin),admin:actor.admin},{headers});
   if(!actor.admin)return Response.json({error:'Administrator review required'},{status:403,headers});
   return Response.json({...await listNameResolutions(deps.db(),actor.uid,url.searchParams.get('after')??''),admin:true},{headers});
  }
  if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers});
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new NameResolutionError(415,'Use application/json');
  const reader=request.body?.getReader();if(!reader)throw new NameResolutionError(400,'JSON body required');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new NameResolutionError(413,'Request too large');}chunks.push(value);}}finally{reader.releaseLock();}
  let input:unknown;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new NameResolutionError(400,'Invalid JSON');}
  const action=parseIdentityAction(input);
  if(action.action!=='propose'&&!actor.admin)return Response.json({error:'Administrator review required'},{status:403,headers});
  return Response.json(await reviewCompanyIdentity(deps.db(),action,actor),{headers});
 }catch(error){return Response.json({error:error instanceof NameResolutionError?error.message:'Unable to review company identity'},{status:error instanceof NameResolutionError?error.status:503,headers});}
}
