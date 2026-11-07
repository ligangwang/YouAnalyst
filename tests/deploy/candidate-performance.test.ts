import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyCandidatePerformance,navigateCandidatePage} from '../../scripts/verify-candidate-performance.mjs';

test('performance gate interleaves fresh samples and rejects a slower candidate',async()=>{
 const calls:string[]=[];
 await assert.rejects(verifyCandidatePerformance({candidateUrl:'new',baselineUrl:'old',samples:3,log:()=>{},measure:async(url:string)=>{
  calls.push(url);return url==='new'?1500:1000;
 }}),/regressed.*existing traffic stays unchanged/);
 assert.deepEqual(calls,['old','new','old','new','new','old','old','new']);
});

test('a cold warm-up is reported separately and cannot mask steady graph performance',async()=>{
 const reads={old:0,new:0};
 const result=await verifyCandidatePerformance({candidateUrl:'new',baselineUrl:'old',samples:3,log:()=>{},measure:async(url:'old'|'new')=>++reads[url]===1?30000:url==='old'?1000:800});
 assert.equal(result.baselineMedianMs,1000);assert.equal(result.candidateMedianMs,800);
 const script=readFileSync('scripts/deploy-cloud-run.sh','utf8');
 const gate=script.indexOf('node scripts/verify-candidate-performance.mjs');
 assert(gate>=0);assert(gate<script.indexOf('node scripts/promote-release.mjs'));
 assert.match(script,/set -euo pipefail/);
});

test('a faster graph cannot hide a slower feed before promotion',async()=>{
 await assert.rejects(verifyCandidatePerformance({candidateUrl:'new',baselineUrl:'old',samples:3,log:()=>{},measure:async(url:string)=>({graphMs:url==='new'?800:1000,feedMs:url==='new'?2000:1000})}),/feed readiness regressed.*existing traffic stays unchanged/);
});

test('complete-page readiness allows a bounded graph tradeoff when the feed finishes sooner',async()=>{
 const result=await verifyCandidatePerformance({candidateUrl:'new',baselineUrl:'old',samples:3,log:()=>{},measure:async(url:string)=>url==='new'?{graphMs:2000,feedMs:1800}:{graphMs:1500,feedMs:3000}});
 assert.equal(result.baselineReadyMedianMs,3000);assert.equal(result.candidateReadyMedianMs,2000);
});

test('a faster complete page cannot hide more than one second of graph delay',async()=>{
 await assert.rejects(verifyCandidatePerformance({candidateUrl:'new',baselineUrl:'old',samples:3,log:()=>{},measure:async(url:string)=>url==='new'?{graphMs:2500,feedMs:2000}:{graphMs:1000,feedMs:4000}}),/graph delay exceeds 1000ms budget.*existing traffic stays unchanged/);
});

test('complete readiness takes the later signal per load before computing the median',async()=>{
 const reads={old:0,new:0},graph=[1000,3000,2000],feed=[3000,1000,2000];
 const result=await verifyCandidatePerformance({candidateUrl:'new',baselineUrl:'old',samples:3,log:()=>{},measure:async(url:'old'|'new')=>{
  if(++reads[url]===1)return {graphMs:1,feedMs:1};
  return url==='new'?{graphMs:2400,feedMs:1800}:{graphMs:graph[reads[url]-2],feedMs:feed[reads[url]-2]};
 }});
 assert.equal(result.baselineReadyMedianMs,3000);assert.equal(result.candidateReadyMedianMs,2400);
});

test('browser navigation retries transient tagged-route 404s before timing the application',async()=>{
 let calls=0,sleeps=0;const codes=[404,404,200];
 const status=await navigateCandidatePage({goto:async()=>({status:()=>codes[calls++]})},'https://candidate.test/en',{sleep:async()=>{sleeps++;},log:()=>{}});
 assert.equal(status,200);assert.equal(calls,3);assert.equal(sleeps,2);
});

test('persistent navigation 404s and non-404 failures cannot pass browser validation',async()=>{
 for(const [status,expected] of [[404,7],[500,1],[429,1]]){
  let calls=0;
  await assert.rejects(navigateCandidatePage({goto:async()=>{calls++;return {status:()=>status};}},'https://candidate.test/en',{sleep:async()=>{},log:()=>{}}),new RegExp(`HTTP ${status}.*existing traffic stays unchanged`));
  assert.equal(calls,expected);
 }
});

test('a broken serving feed is retained as a lower bound while a candidate must settle',async()=>{
 const events:{event?:string;feedTimedOut?:boolean}[]=[];
 const result=await verifyCandidatePerformance({candidateUrl:'new',baselineUrl:'old',samples:3,log:(line:string)=>events.push(JSON.parse(line)),measure:async(url:string)=>url==='old'?{graphMs:1000,feedMs:46000,feedTimedOut:true}:{graphMs:900,feedMs:1800}});
 assert.equal(result.baselineFeedTimeouts,3);assert.equal(result.baselineReadyMedianIsLowerBound,true);
 assert.equal(result.baselineReadyMedianMs,46000);assert.equal(result.candidateReadyMedianMs,1800);
 assert.equal(events.filter(event=>event.event==='candidate_browser_sample'&&event.feedTimedOut).length,3);
 await assert.rejects(verifyCandidatePerformance({candidateUrl:'new',baselineUrl:'old',samples:3,log:()=>{},measure:async()=>({graphMs:1000,feedMs:46000,feedTimedOut:true})}),/Candidate feed failed to settle/);
});

test('a censored observation cannot masquerade as an exact median among slower successful visits',async()=>{
 let baseline=0;
 const result=await verifyCandidatePerformance({candidateUrl:'new',baselineUrl:'old',samples:3,log:()=>{},measure:async(url:string)=>{
  if(url==='new')return {graphMs:900,feedMs:1800};
  const sample=baseline++;
  return sample<=1?{graphMs:1000,feedMs:46000,feedTimedOut:true}:{graphMs:1000,feedMs:sample===2?50000:60000};
 }});
 assert.equal(result.baselineFeedTimeouts,1);assert.equal(result.baselineReadyMedianIsLowerBound,true);assert.equal(result.baselineFeedMedianIsLowerBound,true);
});
