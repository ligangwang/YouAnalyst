import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Broad weights are intentional: new tests are always collected and assigned,
// even before timing history exists. Balance WebGL work across every runner.
export function testWeight(test) {
  if(test.file !== 'knowledge-graph.spec.ts')return 1;
  if(/overview pauses|resumes gently|zoomed and panned/.test(test.title))return 30;
  if(/cinematic introduction|tree approaches and visits|tree continuously surrounds/.test(test.title))return 12;
  return 5;
}
/** @typedef {{file:string,project:string,title:string,id:string}} BrowserTest */
export function collectTests(report) {
  /** @type {BrowserTest[]} */
  const tests=[];
  function visit(suite,parents=[]) {
    const titles=suite.line ? [...parents,suite.title] : parents;
    for(const spec of suite.specs??[])for(const test of spec.tests??[]) {
      const title=[...titles,spec.title].join(' › ');
      tests.push({file:spec.file,project:test.projectName,title,
        id:`[${test.projectName}] › ${spec.file} › ${title}`});
    }
    for(const child of suite.suites??[])visit(child,titles);
  }
  for(const suite of report.suites??[])visit(suite);
  if(!tests.length || new Set(tests.map(t=>t.id)).size!==tests.length)throw new Error('Empty or ambiguous browser test collection');
  return tests;
}
/** @param {BrowserTest[]} tests @param {number} count */
export function balanceTests(tests,count) {
  if(!Number.isInteger(count)||count<1)throw new Error('Invalid shard count');
  /** @type {{weight:number,tests:BrowserTest[]}[]} */
  const shards=Array.from({length:count},()=>({weight:0,tests:[]}));
  const sorted=[...tests].sort((a,b)=>testWeight(b)-testWeight(a)||(a.id<b.id?-1:a.id>b.id?1:0));
  for(const test of sorted){
    const shard=shards.reduce((best,next)=>next.weight<best.weight?next:best);
    shard.tests.push(test);shard.weight+=testWeight(test);
  }
  return shards;
}
function main() {
  const [part,...extra]=process.argv.slice(2),match=/^(\d+)\/(\d+)$/.exec(part??'');
  if(!match)throw new Error('Usage: node scripts/conversion-shards.mjs 1/4 [Playwright options]');
  const index=Number(match[1]),count=Number(match[2]);
  if(index<1||index>count)throw new Error('Invalid shard index');
  const cli=resolve('node_modules/@playwright/test/cli.js');
  const config='--config=playwright.conversion.config.ts';
  const env={...process.env};delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  const listed=spawnSync(process.execPath,[cli,'test',config,'--list','--reporter=json'],{encoding:'utf8',env,maxBuffer:16*1024*1024});
  if(listed.status!==0)throw new Error(listed.stderr||'Browser test collection failed');
  const shards=balanceTests(collectTests(JSON.parse(listed.stdout)),count);
  const shard=shards[index-1];
  if(!shard.tests.length)throw new Error('Empty shard');
  mkdirSync('.cache/conversion-shards',{recursive:true});
  const file=resolve(`.cache/conversion-shards/${index}-of-${count}.txt`);
  writeFileSync(file,shard.tests.map(t=>t.id).join('\n')+'\n');
  console.log(`Browser shard ${part}: ${shard.tests.length} tests; estimated weights ${shards.map(s=>s.weight).join(', ')}`);
  const result=spawnSync(process.execPath,[cli,'test',config,`--test-list=${file}`,...extra],{stdio:'inherit'});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
