import { NextRequest, NextResponse } from 'next/server';
import { getDecodedUserFromRequest } from '@/lib/firebase/auth';
import { isAdminUser } from '@/lib/firebase/admin-role';
import { getAdminFirestore } from '@/lib/firebase/admin';
import { validFundamentalsTicker, usFundamentalsId } from '@/lib/fundamentals/identity';
import { rerunFundamentalsBatch } from '@/lib/fundamentals/admin-rerun';
import { dispatchRequestedFundamentals } from '@/lib/fundamentals/dispatch';
import { listFundamentalsErrors } from '@/lib/fundamentals/admin-errors';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function authorize(request:NextRequest){const user=await getDecodedUserFromRequest(request);return user && await isAdminUser(user)?user:null;}
export async function GET(request:NextRequest){
 if(!await authorize(request))return reply({error:'Forbidden'},403);
 return reply(await listFundamentalsErrors(getAdminFirestore()));
}
export async function POST(request:NextRequest){
 const user=await authorize(request);if(!user)return reply({error:'Forbidden'},403);
 let body;try{body=await request.json();}catch{return reply({error:'Invalid request'},400);}
 if(body?.batchId!==undefined){
  if(typeof body.batchId!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(body.batchId))return reply({error:'Invalid batch'},400);
  try{const accepted=await rerunFundamentalsBatch(getAdminFirestore(),body.batchId,user.uid);return accepted?reply({ok:true},202):reply({error:'Already rerun or resolved'},409);}
  catch{return reply({error:'Could not queue rerun. The failure remains available to retry.'},503);}
 }
 const {ticker}=body??{};if(typeof ticker!=='string'||!validFundamentalsTicker(ticker))return reply({error:'Invalid ticker'},400);
 const db=getAdminFirestore(),ref=db.collection('company_fundamentals').doc(usFundamentalsId(ticker));
 const accepted=await db.runTransaction(async tx=>{const doc=await tx.get(ref);if(!['error','retry'].includes(doc.get('outcome')))return false;
 tx.set(ref,{outcome:'pending',pending:true,refreshAfter:0,dispatchAfter:0,requestedAt:new Date().toISOString(),manualRetryBy:user.uid,manualRetryAt:new Date().toISOString()},{merge:true});return true;});
 if(!accepted)return reply({error:'This failure was already retried or resolved.'},409);
 await dispatchRequestedFundamentals(ticker,db);
 return reply({ok:true},202);
}
