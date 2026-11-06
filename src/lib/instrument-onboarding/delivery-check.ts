import {createHash} from 'node:crypto';
import {ONBOARDING_COLLECTION} from './model';

export const onboardingDeliveryProbeId=(sha:string)=>'INS_'+createHash('sha256').update('onboarding-delivery-check:'+sha).digest('hex').slice(0,32);

/** Authenticated probe of the deployed receiver using an absent request: no writes/providers. */
export async function verifyOnboardingDelivery(input:{url:string;project:string;sha:string;exists:(id:string)=>Promise<boolean>;send:(url:string,headers?:Record<string,string>,body?:Uint8Array)=>Promise<{status:number;data:unknown;disposition?:string}>}){
  const url=new URL(input.url);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.run.app')||url.pathname!=='/'||url.search||url.hash||url.username||url.password||! /^[a-f0-9]{40}$/.test(input.sha))throw Error('Invalid subscriber verification configuration');
  const id=onboardingDeliveryProbeId(input.sha);
  if(await input.exists(id))throw Error('Verification request unexpectedly exists');
  const health=await input.send(new URL('/health',url).href);
  if(health.status!==200||(health.data as {sha?:string})?.sha!==input.sha)throw Error('Subscriber is not the reviewed revision');
  const result=await input.send(new URL('/events',url).href,{'ce-type':'google.cloud.firestore.document.v1.written','ce-source':`//firestore.googleapis.com/projects/${input.project}/databases/(default)`,'ce-specversion':'1.0','ce-id':'delivery-check-'+input.sha,'ce-subject':`documents/${ONBOARDING_COLLECTION}/${id}`,'content-type':'application/protobuf'});
  if(result.status!==204)throw Error('Subscriber delivery check failed');
  // Exercise the real protobuf filter before promotion, not only the absent-ID
  // special probe. Its response proves admission/provider work was bypassed.
  const integer=(raw:number)=>{const bytes:number[]=[];do{const byte=raw%128;raw=Math.floor(raw/128);bytes.push(byte+(raw?128:0));}while(raw);return Buffer.from(bytes);};
  const field=(key:number,value:Buffer|string)=>{const bytes=typeof value==='string'?Buffer.from(value):value;return Buffer.concat([integer(key*8+2),integer(bytes.length),bytes]);};
  const name=`projects/${input.project}/databases/(default)/documents/${ONBOARDING_COLLECTION}/${id}`;
  const document=Buffer.concat([field(1,name),field(2,Buffer.concat([field(1,'status'),field(2,field(17,'PROCESSING'))]))]);
  const filtered=await input.send(new URL('/events',url).href,{'ce-type':'google.cloud.firestore.document.v1.written','ce-source':`//firestore.googleapis.com/projects/${input.project}/databases/(default)`,'ce-specversion':'1.0','ce-id':'filter-check-'+input.sha,'ce-subject':`documents/${ONBOARDING_COLLECTION}/${id}`,'content-type':'application/protobuf'},field(1,document));
  if(filtered.status!==204||filtered.disposition!=='claim_event')throw Error('Subscriber protobuf filter check failed');
  return {status:'verified',instrumentId:id,providerCalls:0};
}
