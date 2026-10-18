import { NextRequest, NextResponse } from 'next/server';
import { getDecodedUserFromRequest } from '@/lib/firebase/auth';
import { isAdminUser } from '@/lib/firebase/admin-role';
import { getAdminFirestore } from '@/lib/firebase/admin';
import { validFundamentalsTicker, usFundamentalsId } from '@/lib/fundamentals/identity';
import { dispatchRequestedFundamentals } from '@/lib/fundamentals/dispatch';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function authorize(request:NextRequest){const user=await getDecodedUserFromRequest(request);return user && await isAdminUser(user)?user:null;}
export async function GET(request:NextRequest){
 if(!await authorize(request))return reply({error:'Forbidden'},403);
 const db=getAdminFirestore();
 const rows=await db.collection('company_fundamentals').where('outcome','in',['error','retry']).limit(100).get();
 return reply({errors:rows.docs.filter(d=>d.id.startsWith('US:')).map(d=>({id:d.id,ticker:d.id.slice(3),message:d.get('lastError')?.message??'Refresh failed',failedAt:d.get('failedAt')??d.get('lastAttemptAt')??null})),limit:100});
}
export async function POST(request:NextRequest){
 const user=await authorize(request);if(!user)return reply({error:'Forbidden'},403);
 const {ticker}=await request.json();if(typeof ticker!=='string'||!validFundamentalsTicker(ticker))return reply({error:'Invalid ticker'},400);
 const db=getAdminFirestore(),ref=db.collection('company_fundamentals').doc(usFundamentalsId(ticker));
 const accepted=await db.runTransaction(async tx=>{const doc=await tx.get(ref);if(!['error','retry'].includes(doc.get('outcome')))return false;
 tx.set(ref,{outcome:'pending',pending:true,refreshAfter:0,dispatchAfter:0,requestedAt:new Date().toISOString(),manualRetryBy:user.uid,manualRetryAt:new Date().toISOString()},{merge:true});return true;});
 if(!accepted)return reply({error:'This failure was already retried or resolved.'},409);
 await dispatchRequestedFundamentals(ticker,db);
 return reply({ok:true},202);
}
