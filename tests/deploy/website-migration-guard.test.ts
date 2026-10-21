import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWebsiteMigrationGuard,discoverCacheSubscriptions} from '../../scripts/firestore/website-migration-guard';
const now=Date.parse('2026-10-21T19:00:00Z');
const json=(data:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status}));
function guard(request:Parameters<typeof createWebsiteMigrationGuard>[0]['request'],subscriptions=['cache']){return createWebsiteMigrationGuard({project:'test-project',startedAt:new Date(now).toISOString(),subscriptions,request,now:()=>now});}
test('migration guard stops on website failures or unavailable safety data',async()=>{
 await assert.rejects(guard(()=>json({entries:[{}]})),/Website errors/);
 await assert.rejects(guard(()=>json({},403)),/unavailable/);
 await assert.rejects(guard(url=>url.includes('logging')?json({}):json({})),/No backlog/);
});
test('migration guard checks backlog freshness and bounds before allowing writes',async()=>{
 const metrics=(value:number,at=now)=>({timeSeries:[{points:[{interval:{endTime:new Date(at).toISOString()},value:{int64Value:String(value)}}]}]});
 await assert.rejects(guard(url=>url.includes('logging')?json({}):json(metrics(1001))),/exceeds/);
 await assert.rejects(guard(url=>url.includes('logging')?json({}):json(metrics(0,now-11*60000))),/Stale/);
 await assert.rejects(guard(url=>url.includes('logging')?json({}):json(metrics(url.includes('oldest_unacked')?121:1))),/exceeds/);
 await guard(url=>url.includes('logging')?json({}):json(metrics(0)))();
 await guard(()=>json({}),[])();
});
test('cache discovery follows pages and includes Eventarc destinations',async()=>{
 const subscriptions=await discoverCacheSubscriptions('test-project','us-central1',url=>{
  if(url.includes('eventarc'))return json({triggers:[{destination:{cloudRun:{path:'/api/internal/cache-changes'}},transport:{pubsub:{subscription:'projects/p/subscriptions/eventarc-1'}}}]});
  return url.includes('pageToken')?json({subscriptions:[{name:'projects/p/subscriptions/cache-updates'}]}):json({subscriptions:[{name:'projects/p/subscriptions/unrelated'}],nextPageToken:'next'});
 });
 assert.deepEqual(subscriptions,['eventarc-1','cache-updates']);
 await assert.rejects(discoverCacheSubscriptions('test-project','us-central1',()=>json({},403)),/Cannot discover/);
});
