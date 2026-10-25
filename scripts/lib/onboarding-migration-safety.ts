import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createMigrationSafetyReader} from '../firestore/migration-safety';

export function onboardingMigrationSafety(input:{project:string;token:()=>string;subscriptions:string[];fetcher?:typeof fetch;read?:ReturnType<typeof createMigrationSafetyReader>}){
  const fetcher=input.fetcher??fetch,read=input.read??createMigrationSafetyReader(),started=new Date().toISOString();
  return async()=>{
    const health=await fetcher('https://youanalyst.com/api/health',{signal:AbortSignal.timeout(30000)});
    assert(health.ok,'Website health unavailable; stop before next migration batch');await health.body?.cancel();
    const response=await read(()=>fetcher('https://logging.googleapis.com/v2/entries:list',{method:'POST',headers:{Authorization:`Bearer ${input.token()}`,'Content-Type':'application/json'},
      body:JSON.stringify({resourceNames:[`projects/${input.project}`],filter:`resource.type="cloud_run_revision" AND resource.labels.service_name="ifindata-web" AND timestamp>="${started}" AND (httpRequest.status>=500 OR httpRequest.status=429 OR textPayload:"Memory limit" OR textPayload:"RESOURCE_EXHAUSTED")`,pageSize:1}),signal:AbortSignal.timeout(30000)}));
    assert(response.ok,'Migration error monitoring unavailable; stop before next batch');
    assert(!(await response.json()).entries?.length,'Website capacity errors detected; stop before next migration batch');
    for(const sub of input.subscriptions)for(const [metric,limit] of [['num_undelivered_messages',1000],['oldest_unacked_message_age',120]] as const){
      const params=new URLSearchParams({filter:`metric.type="pubsub.googleapis.com/subscription/${metric}" AND resource.labels.subscription_id="${sub}"`,'interval.startTime':new Date(Date.now()-20*60000).toISOString(),'interval.endTime':new Date().toISOString(),view:'FULL'});
      const response=await fetcher(`https://monitoring.googleapis.com/v3/projects/${input.project}/timeSeries?${params}`,{headers:{Authorization:`Bearer ${input.token()}`},signal:AbortSignal.timeout(30000)});
      assert(response.ok,'Cache backlog monitoring unavailable');const series=(await response.json()).timeSeries??[];assert(series.length,'Cache backlog metrics missing');
      for(const item of series){const point=item.points?.[0];assert(point&&Date.parse(point.interval.endTime)>Date.now()-10*60000,'Cache backlog metric stale');assert(Number(point.value.int64Value??point.value.doubleValue)<=limit,'Cache backlog too high; stop migration');}
    }
  };
}

/** Same existing cache-trigger discovery and thresholds as read-optimization migration. */
export function onboardingMigrationGuard(project:string){
  assert(/^[a-z][a-z0-9-]+$/.test(project),'Explicit migration project required');
  const run=(args:string[])=>execFileSync(process.platform==='win32'?'gcloud.cmd':'gcloud',args,{encoding:'utf8',shell:process.platform==='win32',timeout:60000}).trim();
  const subscriptions=new Set<string>();
  const triggers=JSON.parse(run(['eventarc','triggers','list','--project',project,'--location',process.env.GCP_REGION??'us-central1','--format=json']));
  for(const trigger of triggers)if(trigger.destination?.cloudRun?.path==='/api/internal/cache-changes'&&trigger.transport?.pubsub?.subscription)subscriptions.add(trigger.transport.pubsub.subscription.split('/').at(-1));
  for(const sub of JSON.parse(run(['pubsub','subscriptions','list','--project',project,'--format=json(name)'])))if(/cache/i.test(sub.name))subscriptions.add(sub.name.split('/').at(-1));
  console.log(JSON.stringify({cacheBacklogSubscriptions:[...subscriptions],sourceListeners:subscriptions.size===0}));
  return onboardingMigrationSafety({project,subscriptions:[...subscriptions],token:()=>process.env.GOOGLE_OAUTH_ACCESS_TOKEN||run(['auth','print-access-token'])});
}
