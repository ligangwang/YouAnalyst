import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Measured costs balance the long WebGL scenarios; everything else falls back to
// its file's median, so new tests are always collected and assigned before they
// have timing history. Refresh with --record-timings (see tests/conversion/README.md).
export const TIMINGS_FILE='tests/conversion/timings.json';
/** @typedef {{fallback:number,files:Record<string,number>,tests:Record<string,number>}} Timings */
/** @returns {Timings} */
export function loadTimings(file=TIMINGS_FILE) {
  return JSON.parse(readFileSync(file,'utf8'));
}
/** @param {BrowserTest} test @param {Timings} timings */
export function testWeight(test,timings) {
  return timings.tests[test.id]??timings.files[test.file]??timings.fallback;
}
/** @typedef {{file:string,project:string,title:string,id:string,result?:{status:string,duration:number}}} BrowserTest */
export function collectTests(report) {
  /** @type {BrowserTest[]} */
  const tests=[];
  function visit(suite,parents=[]) {
    const titles=suite.line ? [...parents,suite.title] : parents;
    for(const spec of suite.specs??[])for(const test of spec.tests??[]) {
      const title=[...titles,spec.title].join(' › ');
      tests.push({file:spec.file,project:test.projectName,title,
        id:`[${test.projectName}] › ${spec.file} › ${title}`,result:test.results?.at(-1)});
    }
    for(const child of suite.suites??[])visit(child,titles);
  }
  for(const suite of report.suites??[])visit(suite);
  if(!tests.length || new Set(tests.map(t=>t.id)).size!==tests.length)throw new Error('Empty or ambiguous browser test collection');
  return tests;
}
/** @param {BrowserTest[]} tests @param {number} count @param {Timings} timings */
export function balanceTests(tests,count,timings) {
  if(!Number.isInteger(count)||count<1)throw new Error('Invalid shard count');
  /** @type {{weight:number,tests:BrowserTest[]}[]} */
  const shards=Array.from({length:count},()=>({weight:0,tests:[]}));
  const weight=test=>testWeight(test,timings);
  const sorted=[...tests].sort((a,b)=>weight(b)-weight(a)||(a.id<b.id?-1:a.id>b.id?1:0));
  for(const test of sorted){
    const shard=shards.reduce((best,next)=>next.weight<best.weight?next:best);
    shard.tests.push(test);shard.weight+=weight(test);
  }
  return shards;
}
// Seconds per test from Playwright JSON reports (one per shard). A failed or
// timed-out run still bounds the cost from below. Only tests that cost at least
// RECORDED_SECONDS are listed; the rest use their file's median.
const RECORDED_SECONDS=5;
/** @param {any[]} reports @returns {Timings} */
export function recordTimings(reports) {
  /** @type {Map<string,{file:string,seconds:number}>} */
  const measured=new Map();
  for(const report of reports)for(const test of collectTests(report))
    if(test.result&&!['skipped','interrupted'].includes(test.result.status))measured.set(test.id,{file:test.file,seconds:test.result.duration/1000});
  if(!measured.size)throw new Error('No executed browser tests to record');
  const round=seconds=>Math.round(seconds*10)/10;
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return round(sorted[sorted.length>>1]);};
  /** @type {Map<string,number[]>} */
  const byFile=new Map();
  for(const {file,seconds} of measured.values())byFile.set(file,[...(byFile.get(file)??[]),seconds]);
  const sortedKeys=entries=>Object.fromEntries([...entries].sort(([a],[b])=>a<b?-1:a>b?1:0));
  return {
    fallback:median([...measured.values()].map(t=>t.seconds)),
    files:sortedKeys([...byFile].map(([file,values])=>[file,median(values)])),
    tests:sortedKeys([...measured].filter(([,t])=>t.seconds>=RECORDED_SECONDS).map(([id,t])=>[id,round(t.seconds)])),
  };
}
function main() {
  const [part,...extra]=process.argv.slice(2);
  if(part==='--record-timings'){
    if(!extra.length)throw new Error('Usage: node scripts/conversion-shards.mjs --record-timings report.json...');
    writeFileSync(TIMINGS_FILE,JSON.stringify(recordTimings(extra.map(file=>JSON.parse(readFileSync(file,'utf8')))),null,1)+'\n');
    return;
  }
  const match=/^(\d+)\/(\d+)$/.exec(part??'');
  if(!match)throw new Error('Usage: node scripts/conversion-shards.mjs 1/4 [Playwright options]');
  const index=Number(match[1]),count=Number(match[2]);
  if(index<1||index>count)throw new Error('Invalid shard index');
  const cli=resolve('node_modules/@playwright/test/cli.js');
  const config='--config=playwright.conversion.config.ts';
  const env={...process.env};delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  const listed=spawnSync(process.execPath,[cli,'test',config,'--list','--reporter=json'],{encoding:'utf8',env,maxBuffer:16*1024*1024});
  if(listed.status!==0)throw new Error(listed.stderr||'Browser test collection failed');
  const shards=balanceTests(collectTests(JSON.parse(listed.stdout)),count,loadTimings());
  const shard=shards[index-1];
  if(!shard.tests.length)throw new Error('Empty shard');
  mkdirSync('.cache/conversion-shards',{recursive:true});
  const file=resolve(`.cache/conversion-shards/${index}-of-${count}.txt`);
  writeFileSync(file,shard.tests.map(t=>t.id).join('\n')+'\n');
  console.log(`Browser shard ${part}: ${shard.tests.length} tests; estimated seconds ${shards.map(s=>Math.round(s.weight)).join(', ')}`);
  const result=spawnSync(process.execPath,[cli,'test',config,`--test-list=${file}`,...extra],{stdio:'inherit'});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
