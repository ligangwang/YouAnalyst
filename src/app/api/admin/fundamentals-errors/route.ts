import { NextRequest, NextResponse } from 'next/server';
import { getDecodedUserFromRequest } from '@/lib/firebase/auth';
import { isAdminUser } from '@/lib/firebase/admin-role';
import { getAdminFirestore } from '@/lib/firebase/admin';
import { validFundamentalsTicker, usFundamentalsId } from '@/lib/fundamentals/identity';
import { rerunFundamentalsBatch } from '@/lib/fundamentals/admin-rerun';
import { dispatchRequestedFundamentals } from '@/lib/fundamentals/dispatch';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function authorize(request:NextRequest){const user=await getDecodedUserFromRequest(request);return user && await isAdminUser(user)?user:null;}
export async function GET(request:NextRequest){
 if(!await authorize(request))return reply({error:'Forbidden'},403);
 const db=getAdminFirestore();
 const [rows,batches]=await Promise.all([db.collection('company_fundamentals').where('outcome','in',['error','retry']).limit(100).get(),db.collection('company_fundamentals').where('manualRequired','==',true).limit(100).get()]);
 const companyBatches=new Map<string,string>();for(const batch of batches.docs)for(const ticker of batch.get('request')?.companyIds??[])companyBatches.set(ticker,batch.id.replace(/^_batch_/,''));
 const batchErrors=batches.docs.map(d=>({id:d.id,batchId:d.id.replace(/^_batch_/,''),ticker:(d.get('request')?.companyIds??[]).join(', '),message:d.get('lastError')?.message??'Batch failed',failedAt:d.get('failedAt')??null}));
 return reply({errors:[...batchErrors,...rows.docs.filter(d=>d.id.startsWith('US:')).map(d=>({id:d.id,batchId:companyBatches.get(d.id.slice(3)),ticker:d.id.slice(3),message:d.get('lastError')?.message??'Refresh failed',failedAt:d.get('failedAt')??d.get('lastAttemptAt')??null}))],limit:200});
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
