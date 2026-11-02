import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const project='ifindata-80905',subscription='eventarc-us-east4-instrument-onboarding-requests-sub-871';
const website='https://youanalyst.com';
const end=new Date(),start=new Date(end.getTime()-5*60_000);
function cloud(args:string[]){
 const command=process.platform==='win32'?'cmd.exe':'gcloud',actual=process.platform==='win32'?['/d','/s','/c','gcloud '+args.join(' ')]:args;
 const result=spawnSync(command,actual,{encoding:'utf8',stdio:['ignore','pipe','pipe']});if(result.status!==0)throw Error('Cloud monitoring command failed');return result.stdout.trim();
}
async function token(){
 if(process.env.CLOUD_RUN_JOB){
  const credential=await json('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',{headers:{'Metadata-Flavor':'Google'}});
  if(typeof credential.access_token!=='string')throw Error('Runtime credentials unavailable');
  return credential.access_token as string;
 }
 return cloud(['auth','print-access-token']);
}
async function inventory(url:string,key:string,headers:Record<string,string>){
 const items:Record<string,any>[]=[]; // eslint-disable-line @typescript-eslint/no-explicit-any
 let pageToken='';
 do{const endpoint=new URL(url);if(pageToken)endpoint.searchParams.set('pageToken',pageToken);
  const result=await json(endpoint.toString(),{headers});items.push(...(result[key]??[]));pageToken=result.nextPageToken??'';
 }while(pageToken);
 return items;
}
async function json(url:string,options:RequestInit={}){const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Monitor request failed: ${response.status}`);return response.json();}
export async function observeOnboardingCapacity(credential:string){
 const auth={Authorization:`Bearer ${credential}`,'Content-Type':'application/json'};
 const checks=await Promise.all([fetch(website+'/api/health',{signal:AbortSignal.timeout(30000)}),fetch(website+'/',{signal:AbortSignal.timeout(30000)})]);
 const webHealthy=checks.every(response=>response.ok);await Promise.all(checks.map(response=>response.body?.cancel()));
 const logs=await json('https://logging.googleapis.com/v2/entries:list',{method:'POST',headers:auth,body:JSON.stringify({resourceNames:[`projects/${project}`],filter:`resource.type="cloud_run_revision" AND resource.labels.service_name="ifindata-web" AND timestamp>="${start.toISOString()}" AND (httpRequest.status>=500 OR httpRequest.status=429 OR textPayload:"Memory limit" OR textPayload:"RESOURCE_EXHAUSTED")`,pageSize:1})});
 const triggers=await inventory(`https://eventarc.googleapis.com/v1/projects/${project}/locations/us-east4/triggers`,'triggers',auth);
 const subscriptions=await inventory(`https://pubsub.googleapis.com/v1/projects/${project}/subscriptions`,'subscriptions',auth);
 const cacheSubscriptions=new Set<string>();
 for(const trigger of triggers)if(trigger.destination?.cloudRun?.path==='/api/internal/cache-changes'&&trigger.transport?.pubsub?.subscription)cacheSubscriptions.add(trigger.transport.pubsub.subscription.split('/').at(-1));
 for(const item of subscriptions)if(/cache/i.test(item.name))cacheSubscriptions.add(item.name.split('/').at(-1));
 const usageWarnings=await json('https://logging.googleapis.com/v2/entries:list',{method:'POST',headers:auth,body:JSON.stringify({resourceNames:[`projects/${project}`],filter:`resource.type="cloud_run_revision" AND resource.labels.service_name="instrument-onboarding-subscriber" AND timestamp>="${start.toISOString()}" AND textPayload:"Failed to record OpenAI usage event"`,pageSize:1})});
 const metrics:Record<string,Record<string,number|null>>={};
 for(const sub of [subscription,...cacheSubscriptions]){
  metrics[sub]={};
  for(const metric of ['num_undelivered_messages','oldest_unacked_message_age']){
   const params=new URLSearchParams({filter:`metric.type="pubsub.googleapis.com/subscription/${metric}" AND resource.labels.subscription_id="${sub}"`,'interval.startTime':new Date(end.getTime()-20*60_000).toISOString(),'interval.endTime':end.toISOString(),view:'FULL'});
   const result=await json(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${params}`,{headers:auth});
   const points=(result.timeSeries??[]).flatMap((series:{points?:{interval:{endTime:string};value:{int64Value?:string;doubleValue?:number}}[]})=>series.points??[]).sort((a:{interval:{endTime:string}},b:{interval:{endTime:string}})=>b.interval.endTime.localeCompare(a.interval.endTime));
   metrics[sub][metric]=points.length&&Date.parse(points[0].interval.endTime)>=end.getTime()-10*60_000?Number(points[0].value.int64Value??points[0].value.doubleValue):null;
  }
 }
 const cacheBacklogHigh=[...cacheSubscriptions].some(sub=>metrics[sub].num_undelivered_messages===null||metrics[sub].oldest_unacked_message_age===null||metrics[sub].num_undelivered_messages!>1000||metrics[sub].oldest_unacked_message_age!>120);
 const usage=await json(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:runQuery`,{method:'POST',headers:auth,body:JSON.stringify({structuredQuery:{from:[{collectionId:'openai_usage_events'}],select:{fields:['purpose','estimatedCostUsd','createdAt'].map(fieldPath=>({fieldPath}))},where:{fieldFilter:{field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:start.toISOString()}}},orderBy:[{field:{fieldPath:'createdAt'}}]}})});
 let events=0,unknownCosts=0,estimatedUsd=0,allEvents=0,allUnknownCosts=0,allEstimatedUsd=0;for(const row of usage){const fields=row.document?.fields;if(!fields)continue;const value=fields.estimatedCostUsd;const known=value?.doubleValue!==undefined||value?.integerValue!==undefined;const cost=known?Number(value.doubleValue??value.integerValue):0;allEvents++;if(known)allEstimatedUsd+=cost;else allUnknownCosts++;if(fields.purpose?.stringValue!=='company_theme_classification')continue;events++;if(known)estimatedUsd+=cost;else unknownCosts++;}
 const websiteErrors=(logs.entries??[]).length;
 return {at:end.toISOString(),windowStart:start.toISOString(),webHealthy,websiteErrors,backlog:metrics[subscription].num_undelivered_messages,oldestAgeSeconds:metrics[subscription].oldest_unacked_message_age,cacheSubscriptions:[...cacheSubscriptions],cacheBacklogHigh,classificationEvents:events,estimatedUsd,unknownCosts,allEvents,allEstimatedUsd,allUnknownCosts,usageLoggingErrors:(usageWarnings.entries??[]).length,pauseNewBatches:!webHealthy||websiteErrors>0||cacheBacklogHigh||Object.values(metrics[subscription]).some(value=>value===null)};
}
async function main(){
 const credential=await token();let observed:Awaited<ReturnType<typeof observeOnboardingCapacity>>|undefined;let failure='';
 try{observed=await observeOnboardingCapacity(credential);}catch(error){failure=error instanceof Error?error.message:'Monitor unavailable';}
 const paused=!observed||observed.pauseNewBatches;
 if(process.argv.includes('--write-control')){
  const params=new URLSearchParams();params.append('updateMask.fieldPaths','pauseNewBatches');params.append('updateMask.fieldPaths','monitorHeartbeatAt');
  await json(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/collectors/instrument-onboarding-safety?${params}`,{method:'PATCH',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({fields:{pauseNewBatches:{booleanValue:paused},monitorHeartbeatAt:{timestampValue:new Date().toISOString()}}})});
 }
 console.log(JSON.stringify({...(observed??{at:new Date().toISOString()}),pauseNewBatches:paused,...(failure?{failure}:{}),controlUpdated:process.argv.includes('--write-control')}));
 if(failure)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof Error?error.message:'Monitor failed');process.exitCode=1;});
