import {NextRequest,NextResponse} from 'next/server';
import type {Firestore} from 'firebase-admin/firestore';
import {getAdminFirestore} from '../firebase/admin';
import {getDecodedUserFromRequest} from '../firebase/auth';
import {isAdminUser} from '../firebase/admin-role';
import {validInstrumentId} from '../instruments/model';
import {OnboardingBlocked,validRequesterUid} from './model';
import {requestInstrumentOnboarding} from './queue';
import {hasTrustedRequestOrigin} from '../request-origin';

const dependencies={getUser:getDecodedUserFromRequest,isAdmin:isAdminUser,db:getAdminFirestore,enqueue:requestInstrumentOnboarding,pause:()=>new Promise<void>(resolve=>setTimeout(resolve,200))};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
type Accepted=Awaited<ReturnType<typeof requestInstrumentOnboarding>>;
type Result={index:number;instrumentId?:string;companyId?:string;status:Accepted['status']|'REJECTED'|'ERROR'|'DEFERRED';outcome:'QUEUED'|'ALREADY_REQUESTED'|'ALREADY_SUPPORTED'|'REJECTED'|'ERROR'|'DEFERRED';error?:string};

/** Admin intent only: no provider calls, worker execution, or role impersonation. */
export async function adminBatchOnboardingResponse(request:NextRequest,deps=dependencies){
  const user=await deps.getUser(request);if(!user)return json({error:'Unauthorized'},401);
  if(!validRequesterUid(user.uid)||!user.firebase?.sign_in_provider||user.firebase.sign_in_provider==='anonymous'||!await deps.isAdmin(user))return json({error:'Forbidden'},403);
  if(!hasTrustedRequestOrigin(request))return json({error:'Invalid request origin'},403);
  if(Number(request.headers.get('content-length'))>16384)return json({error:'Request too large'},413);
  let value:unknown;
  try{const body=await request.text();if(Buffer.byteLength(body,'utf8')>16384)return json({error:'Request too large'},413);value=JSON.parse(body);}catch{return json({error:'Invalid request'},400);}
  const rows=(value as {items?:unknown}|null)?.items;
  if(!Array.isArray(rows)||rows.length<1||rows.length>25)return json({error:'items must contain between 1 and 25 instruments'},400);
  const results:Result[]=[],accepted=new Map<string,Accepted>();
  let db:Firestore|undefined,attempted=false,stopped=false;
  for(let index=0;index<rows.length;index++){
    const row=rows[index] as {instrumentId?:unknown;listingId?:unknown}|null;
    const id=row?.instrumentId,listingId=row?.listingId;
    if(typeof id!=='string'||!validInstrumentId(id)||(listingId!==undefined&&(typeof listingId!=='string'||! /^(US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(listingId)))){
      results.push({index,...(typeof id==='string'&&validInstrumentId(id)?{instrumentId:id}:{}),status:'REJECTED',outcome:'REJECTED',error:'Invalid instrumentId or listingId'});continue;
    }
    const prior=accepted.get(id);
    if(prior){results.push({index,instrumentId:id,companyId:prior.companyId,status:prior.status,outcome:prior.status==='SUPPORTED'?'ALREADY_SUPPORTED':'ALREADY_REQUESTED'});continue;}
    if(stopped){results.push({index,instrumentId:id,status:'DEFERRED',outcome:'DEFERRED',error:'Batch stopped after a storage error; safe to retry'});continue;}
    try{
      if(attempted)await deps.pause();attempted=true;
      const result=await deps.enqueue(db??=deps.db(),id,user.uid,listingId);
      accepted.set(id,result);
      results.push({index,instrumentId:id,companyId:result.companyId,status:result.status,outcome:result.status==='SUPPORTED'?'ALREADY_SUPPORTED':result.created?'QUEUED':'ALREADY_REQUESTED'});
    }catch(error){
      if(error instanceof OnboardingBlocked)results.push({index,instrumentId:id,status:'REJECTED',outcome:'REJECTED',error:error.message});
      else{stopped=true;results.push({index,instrumentId:id,status:'ERROR',outcome:'ERROR',error:'Unable to record request; safe to retry'});}
    }
  }
  return json({ok:results.every(row=>!['REJECTED','ERROR','DEFERRED'].includes(row.status)),items:results},stopped?503:200);
}
