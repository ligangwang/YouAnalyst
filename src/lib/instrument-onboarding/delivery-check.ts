import {createHash} from 'node:crypto';
import {ONBOARDING_COLLECTION} from './model';

/** Authenticated probe of the deployed receiver using an absent request: no writes/providers. */
export async function verifyOnboardingDelivery(input:{url:string;project:string;sha:string;exists:(id:string)=>Promise<boolean>;send:(url:string,headers?:Record<string,string>)=>Promise<{status:number;data:unknown}>}){
  const url=new URL(input.url);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.run.app')||url.pathname!=='/'||url.search||url.hash||url.username||url.password||! /^[a-f0-9]{40}$/.test(input.sha))throw Error('Invalid subscriber verification configuration');
  const id='INS_'+createHash('sha256').update('onboarding-delivery-check:'+input.sha).digest('hex').slice(0,32);
  if(await input.exists(id))throw Error('Verification request unexpectedly exists');
  const health=await input.send(new URL('/health',url).href);
  if(health.status!==200||(health.data as {sha?:string})?.sha!==input.sha)throw Error('Subscriber is not the reviewed revision');
  const result=await input.send(new URL('/events',url).href,{'ce-type':'google.cloud.firestore.document.v1.written','ce-source':`//firestore.googleapis.com/projects/${input.project}/databases/(default)`,'ce-specversion':'1.0','ce-id':'delivery-check-'+input.sha,'ce-subject':`documents/${ONBOARDING_COLLECTION}/${id}`,'content-type':'application/protobuf'});
  if(result.status!==204)throw Error('Subscriber delivery check failed');
  return {status:'verified',instrumentId:id,providerCalls:0};
}
