import {NextRequest,NextResponse} from 'next/server';
import {getDecodedUserFromRequest} from '../firebase/auth';
import {isAdminUser} from '../firebase/admin-role';
import {getAdminFirestore} from '../firebase/admin';
import {hasTrustedRequestOrigin} from '../request-origin';
import {editCompanyThemes,readThemeEditor,ThemeEditConflict} from './admin';
const dependencies={user:getDecodedUserFromRequest,isAdmin:isAdminUser,db:getAdminFirestore,read:readThemeEditor,edit:editCompanyThemes};
const json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function companyThemesResponse(request:NextRequest,overrides:Partial<typeof dependencies>={}){
  const deps={...dependencies,...overrides};
  const user=await deps.user(request);if(!user)return json({error:'Unauthorized'},401);
  if(!user.firebase?.sign_in_provider||user.firebase.sign_in_provider==='anonymous'||!await deps.isAdmin(user))return json({error:'Forbidden'},403);
  if(request.method!=='GET'&&!hasTrustedRequestOrigin(request))return json({error:'Invalid request origin'},403);
  const id=request.nextUrl.searchParams.get('companyId');
  if(!id||id.length>100||! /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9.-]+)$/.test(id))return json({error:'Invalid company'},400);
  try{
    if(request.method==='GET')return json(await deps.read(deps.db(),id));
    if(Number(request.headers.get('content-length'))>65536)return json({error:'Request too large'},413);
    const text=await request.text();if(Buffer.byteLength(text)>65536)return json({error:'Request too large'},413);
    let value;try{value=JSON.parse(text);}catch{return json({error:'Invalid request'},400);}
    if(!value||typeof value.version!=='string'||! /^[a-f0-9]{64}$/.test(value.version)||!Array.isArray(value.assignments))return json({error:'Invalid request'},400);
    const result=await deps.edit(deps.db(),id,value.version,value.assignments);
    console.info('Company themes updated',{companyId:id,actorUid:user.uid,themeIds:result.themeIds});
    return json(result);
  }catch(error){
    if(error instanceof ThemeEditConflict)return json({error:'Company changed. Reload before saving.'},409);
    if(error instanceof Error&&error.name==='AssertionError')return json({error:'Invalid theme assignment or source evidence.'},400);
    return json({error:'Unable to load or save company themes.'},503);
  }
}
