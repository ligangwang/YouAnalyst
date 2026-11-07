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
