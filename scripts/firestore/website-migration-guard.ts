import assert from 'node:assert/strict';
import {GoogleAuth} from 'google-auth-library';
import {createMigrationSafetyReader} from './migration-safety';

type Request=(url:string,init?:RequestInit)=>Promise<Response>;
export function authenticatedMigrationRequest():Request {
  const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
  return async(url,init)=>{
    const token=await auth.getAccessToken();assert(token,'Migration monitoring credentials unavailable');
    return fetch(url,{...init,headers:{...init?.headers,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  };
}
export async function discoverCacheSubscriptions(project:string,region:string,request:Request){
  assert(/^[a-z][a-z0-9-]+$/.test(project)&&/^[a-z0-9-]+$/.test(region),'Invalid project/region');
  const result=new Set<string>();
  for(const [url,key] of [
    [`https://eventarc.googleapis.com/v1/projects/${project}/locations/${region}/triggers`,'triggers'],
    [`https://pubsub.googleapis.com/v1/projects/${project}/subscriptions`,'subscriptions'],
  ]){
    let token='';
    do{
      const response=await request(url+(token?`?pageToken=${encodeURIComponent(token)}`:''));assert(response.ok,`Cannot discover cache backlog (${response.status})`);
      const data=await response.json();
      for(const item of data[key]??[]){
        const sub=key==='triggers'?item.destination?.cloudRun?.path==='/api/internal/cache-changes'?item.transport?.pubsub?.subscription:null:/cache/i.test(item.name)?item.name:null;
        if(sub)result.add(String(sub).split('/').at(-1)!);
      }
      token=data.nextPageToken??'';
    }while(token);
  }
  return [...result];
}
export function createWebsiteMigrationGuard(options:{project:string;startedAt:string;subscriptions:string[];request:Request;now?:()=>number;sleep?:(ms:number)=>Promise<void>}){
  const now=options.now??Date.now,read=createMigrationSafetyReader({now,sleep:options.sleep});
  return async()=>{
    const response=await read(()=>options.request('https://logging.googleapis.com/v2/entries:list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resourceNames:[`projects/${options.project}`],filter:`resource.type="cloud_run_revision" AND resource.labels.service_name="ifindata-web" AND timestamp>="${options.startedAt}" AND (httpRequest.status>=500 OR httpRequest.status=429 OR severity>=ERROR OR textPayload:"Memory limit" OR textPayload:"RESOURCE_EXHAUSTED")`,pageSize:1})}));
    assert(response.ok,`Website safety monitoring unavailable (${response.status})`);
    assert(!(await response.json()).entries?.length,'Website errors detected; stop migration');
    for(const subscription of options.subscriptions){
      for(const [metric,limit] of [['num_undelivered_messages',1000],['oldest_unacked_message_age',120]] as const){
        const params=new URLSearchParams({filter:`metric.type="pubsub.googleapis.com/subscription/${metric}" AND resource.labels.subscription_id="${subscription}"`,'interval.startTime':new Date(now()-20*60000).toISOString(),'interval.endTime':new Date(now()).toISOString(),view:'FULL'});
        const metrics=await options.request(`https://monitoring.googleapis.com/v3/projects/${options.project}/timeSeries?${params}`);assert(metrics.ok,`Cache backlog monitoring unavailable (${metrics.status})`);
        const data=await metrics.json(),series=data.timeSeries??[];
        assert(!data.nextPageToken,'Incomplete cache backlog metrics');assert(series.length,`No backlog metrics for ${subscription}; stop migration`);
        let max=0;
        for(const item of series){const point=item.points?.[0],value=Number(point?.value?.int64Value??point?.value?.doubleValue);
          assert(point&&Date.parse(point.interval.endTime)>now()-10*60000,'Stale cache backlog metric');
          assert(Number.isFinite(value)&&value>=0&&value<=limit,`Cache backlog ${metric} exceeds ${limit}; stop migration`);max=Math.max(max,value);
        }
        if(metric==='num_undelivered_messages'&&max===0)break;
      }
    }
  };
}
