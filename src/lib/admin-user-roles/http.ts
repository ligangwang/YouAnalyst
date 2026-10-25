import {NextRequest,NextResponse} from 'next/server';
import {getAdminAuth,getAdminFirestore} from '../firebase/admin';
import {getDecodedUserFromRequest} from '../firebase/auth';
import {authorizeUserRoleAdmin,lookupUserRole,changeUserRole,UserRoleError,validUserRoleUid} from './service';
import {hasTrustedRequestOrigin} from '../request-origin';

const dependencies={getUser:getDecodedUserFromRequest,db:getAdminFirestore,auth:getAdminAuth,authorize:authorizeUserRoleAdmin,lookup:lookupUserRole,change:changeUserRole};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function userRoleResponse(request:NextRequest,deps=dependencies){
  const user=await deps.getUser(request);if(!user)return json({error:'Unauthorized'},401);
  if(!validUserRoleUid(user.uid)||!user.firebase?.sign_in_provider||user.firebase.sign_in_provider==='anonymous')return json({error:'Forbidden'},403);
  try{
    const db=deps.db(),auth=deps.auth(),actor=await deps.authorize(db,auth,user.uid);
    if(request.method==='GET')return json({user:await deps.lookup(db,auth,actor,request.nextUrl.searchParams.get('q')??'')});
    if(request.method!=='PATCH')return json({error:'Method not allowed'},405);
    if(!hasTrustedRequestOrigin(request))return json({error:'Invalid request origin'},403);
    if(Number(request.headers.get('content-length'))>4096)return json({error:'Request too large'},413);
    let value:{userId?:unknown;admin?:unknown;version?:unknown};
    try{const body=await request.text();if(Buffer.byteLength(body,'utf8')>4096)return json({error:'Request too large'},413);value=JSON.parse(body);}catch{return json({error:'Invalid request'},400);}
    if(!value||!validUserRoleUid(value.userId)||typeof value.admin!=='boolean'||typeof value.version!=='string')return json({error:'userId, admin and version are required'},400);
    return json({user:await deps.change(db,auth,actor,value.userId,value.admin,value.version)});
  }catch(error){
    if(error instanceof UserRoleError)return json({error:error.message},error.status);
    return json({error:'Unable to manage admin access. Check Firebase Authentication read permissions and retry.'},503);
  }
}
