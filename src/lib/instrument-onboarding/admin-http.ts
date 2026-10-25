import {NextRequest,NextResponse} from 'next/server';
import {getAdminFirestore} from '../firebase/admin';
import {getDecodedUserFromRequest} from '../firebase/auth';
import {isAdminUser} from '../firebase/admin-role';
import {ONBOARDING_STEPS,type OnboardingStep} from './model';
import {listInstrumentOnboarding} from './admin';
import {retryInstrumentOnboarding} from './queue';
import {validInstrumentId} from '../instruments/model';
import {listInstrumentRequesters,validRequesterCursor} from './requesters';

const dependencies={getUser:getDecodedUserFromRequest,isAdmin:isAdminUser,db:getAdminFirestore,list:listInstrumentOnboarding,requesters:listInstrumentRequesters,retry:retryInstrumentOnboarding};
const headers={'Cache-Control':'private, no-store'};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});

export async function adminOnboardingResponse(request:NextRequest,deps=dependencies){
  const user=await deps.getUser(request);if(!user)return json({error:'Unauthorized'},401);
  if(!await deps.isAdmin(user))return json({error:'Forbidden'},403);
  if(request.method==='GET'){
    const instrumentId=request.nextUrl.searchParams.get('instrumentId');
    if(instrumentId!==null){
      const cursor=request.nextUrl.searchParams.get('requesterCursor')??undefined;
      if(!validInstrumentId(instrumentId)||(cursor&&!validRequesterCursor(cursor)))return json({error:'Invalid requester query'},400);
      try{return json(await deps.requesters(deps.db(),instrumentId,cursor));}catch{return json({error:'Unable to load requesters'},503);}
    }
    const cursor=request.nextUrl.searchParams.get('cursor')??undefined;
    if(cursor&&!validInstrumentId(cursor))return json({error:'Invalid cursor'},400);
    try{return json(await deps.list(deps.db(),cursor));}catch{return json({error:'Unable to load onboarding requests'},503);}
  }
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const origin=request.headers.get('origin');if(origin&&origin!==request.nextUrl.origin)return json({error:'Invalid request origin'},403);
  if(Number(request.headers.get('content-length'))>4096)return json({error:'Request too large'},413);
  let value:Record<string,unknown>;
  try{const body=await request.text();if(body.length>4096)return json({error:'Request too large'},413);value=JSON.parse(body);}catch{return json({error:'Invalid request'},400);}
  if(!value||typeof value.instrumentId!=='string'||!validInstrumentId(value.instrumentId)||typeof value.step!=='string'||!ONBOARDING_STEPS.includes(value.step as OnboardingStep)||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt)))return json({error:'Invalid retry request'},400);
  try{return json(await deps.retry(deps.db(),value.instrumentId,{step:value.step as OnboardingStep,updatedAt:value.updatedAt}));}
  catch{return json({error:'Request changed, is active, or needs an identity correction. Refresh before retrying.'},409);}
}
