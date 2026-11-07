import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import probe from './graph-readiness-probe.cjs';
const {installGraphReadinessProbe}=probe;

const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];

/** Interleave fresh browser contexts so deployment warmth/order cannot choose a winner. */
export async function verifyCandidatePerformance({candidateUrl,baselineUrl,measure,samples=5,maxRegressionRatio=1.1,log=console.log}) {
  assert(candidateUrl&&baselineUrl&&typeof measure==='function');
  assert(Number.isInteger(samples)&&samples>=3&&samples%2===1);
  const urls={baseline:baselineUrl,candidate:candidateUrl},results={baseline:[],candidate:[]},feeds={baseline:[],candidate:[]};
  const timing=async url=>{const value=await measure(url);return typeof value==='number'?{graphMs:value}:value;};
  for(const label of ['baseline','candidate']){const value=await timing(urls[label]);log(JSON.stringify({event:'candidate_browser_warmup',label,durationMs:value.graphMs,feedDurationMs:value.feedMs}));}
  for(let round=0;round<samples;round++) {
    for(const label of round%2?['candidate','baseline']:['baseline','candidate']) {
      const {graphMs:durationMs,feedMs}=await timing(urls[label]);
      assert(Number.isFinite(durationMs)&&durationMs>0,'Invalid browser timing');
      results[label].push(durationMs);
      if(feedMs!==undefined){assert(Number.isFinite(feedMs)&&feedMs>0,'Invalid feed timing');feeds[label].push(feedMs);}
      log(JSON.stringify({event:'candidate_browser_sample',label,round:round+1,durationMs,feedDurationMs:feedMs}));
    }
  }
  const summary={event:'candidate_browser_performance',baselineMedianMs:median(results.baseline),candidateMedianMs:median(results.candidate),samples,maxRegressionRatio};
  log(JSON.stringify(summary));
  assert(summary.candidateMedianMs<=summary.baselineMedianMs*maxRegressionRatio,
    `Candidate graph display regressed: ${Math.round(summary.candidateMedianMs)}ms versus ${Math.round(summary.baselineMedianMs)}ms; existing traffic stays unchanged`);
  if(feeds.baseline.length||feeds.candidate.length){
    assert(feeds.baseline.length===samples&&feeds.candidate.length===samples,'Incomplete feed performance samples');
    summary.baselineFeedMedianMs=median(feeds.baseline);summary.candidateFeedMedianMs=median(feeds.candidate);
    log(JSON.stringify({event:'candidate_feed_performance',baselineMedianMs:summary.baselineFeedMedianMs,candidateMedianMs:summary.candidateFeedMedianMs,samples,maxRegressionRatio}));
    assert(summary.candidateFeedMedianMs<=summary.baselineFeedMedianMs*maxRegressionRatio,
      `Candidate feed readiness regressed: ${Math.round(summary.candidateFeedMedianMs)}ms versus ${Math.round(summary.baselineFeedMedianMs)}ms; existing traffic stays unchanged`);
  }
  return summary;
}

async function run() {
  const {chromium}=await import('@playwright/test');
  const browser=await chromium.launch();
  try {
    await verifyCandidatePerformance({candidateUrl:process.env.CANDIDATE_URL,baselineUrl:process.env.BASELINE_URL,measure:async url=>{
      const context=await browser.newContext({viewport:{width:1440,height:1000}});
      try {
        const page=await context.newPage();
        await page.addInitScript(installGraphReadinessProbe);
        await page.goto(new URL('/en',url).href,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>window.__releaseGraphReadyAt!==null&&window.__releaseFeedReadyAt!==null,{},{timeout:45000});
        const duration=await page.evaluate(()=>({graphMs:window.__releaseGraphReadyAt,feedMs:window.__releaseFeedReadyAt}));
        await page.waitForTimeout(300);
        return duration;
      } finally {await context.close();}
    }});
  } catch(error) {console.error(error.message);process.exitCode=1;}
  finally {await browser.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  run().catch(error=>{console.error(error.message);process.exitCode=1;});
}
