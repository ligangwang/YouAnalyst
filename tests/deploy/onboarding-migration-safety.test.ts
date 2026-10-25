import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingMigrationSafety} from '../../scripts/lib/onboarding-migration-safety';

test('migration guards stop before writes on website errors or unavailable monitoring',async()=>{
  for(const failure of ['health','errors','logs']){
    let writes=0;
    const guard=onboardingMigrationSafety({project:'demo',token:()=>'',subscriptions:[],read:async work=>work(),fetcher:(async(url:RequestInfo|URL)=>{
      if(String(url).includes('/api/health'))return new Response('',{status:failure==='health'?503:200});
      return Response.json({entries:failure==='errors'?[{}]:[]},{status:failure==='logs'?503:200});
    }) as typeof fetch});
    await assert.rejects(async()=>{await guard();writes++;});assert.equal(writes,0);
  }
});

test('migration guards require recent bounded cache backlog metrics',async()=>{
  let backlog=0,stale=false;
  const guard=onboardingMigrationSafety({project:'demo',token:()=>'',subscriptions:['cache-events'],read:async work=>work(),fetcher:(async(url:RequestInfo|URL)=>{
    if(String(url).includes('/api/health'))return new Response('',{status:200});
    if(String(url).includes('logging.googleapis.com'))return Response.json({entries:[]});
    return Response.json({timeSeries:[{points:[{interval:{endTime:new Date(Date.now()-(stale?11*60000:0)).toISOString()},value:{int64Value:String(backlog)}}]}]});
  }) as typeof fetch});
  await guard();backlog=1001;await assert.rejects(()=>guard(),/backlog too high/);
  backlog=0;stale=true;await assert.rejects(()=>guard(),/metric stale/);
});
