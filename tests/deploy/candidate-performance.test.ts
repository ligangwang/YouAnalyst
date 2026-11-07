import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyCandidatePerformance} from '../../scripts/verify-candidate-performance.mjs';

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
