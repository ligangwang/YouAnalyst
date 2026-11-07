import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import probe from './graph-readiness-probe.cjs';
const {installGraphReadinessProbe}=probe;

const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];

/** Interleave fresh browser contexts so deployment warmth/order cannot choose a winner. */
export async function verifyCandidatePerformance({candidateUrl,baselineUrl,measure,samples=5,maxRegressionRatio=1.1,maxGraphDelayMs=1000,log=console.log}) {
  assert(candidateUrl&&baselineUrl&&typeof measure==='function');
  assert(Number.isInteger(samples)&&samples>=3&&samples%2===1);
  assert(Number.isFinite(maxGraphDelayMs)&&maxGraphDelayMs>=0);
  const urls={baseline:baselineUrl,candidate:candidateUrl},results={baseline:[],candidate:[]},feeds={baseline:[],candidate:[]},ready={baseline:[],candidate:[]};
  const timing=async url=>{const value=await measure(url);return typeof value==='number'?{graphMs:value}:value;};
  for(const label of ['baseline','candidate']){const value=await timing(urls[label]);log(JSON.stringify({event:'candidate_browser_warmup',label,durationMs:value.graphMs,feedDurationMs:value.feedMs}));}
  for(let round=0;round<samples;round++) {
    for(const label of round%2?['candidate','baseline']:['baseline','candidate']) {
      const {graphMs:durationMs,feedMs}=await timing(urls[label]);
      assert(Number.isFinite(durationMs)&&durationMs>0,'Invalid browser timing');
      results[label].push(durationMs);
      if(feedMs!==undefined){assert(Number.isFinite(feedMs)&&feedMs>0,'Invalid feed timing');feeds[label].push(feedMs);}
      ready[label].push(Math.max(durationMs,feedMs??durationMs));
      log(JSON.stringify({event:'candidate_browser_sample',label,round:round+1,durationMs,feedDurationMs:feedMs}));
    }
  }
  const summary={event:'candidate_browser_performance',baselineMedianMs:median(results.baseline),candidateMedianMs:median(results.candidate),baselineReadyMedianMs:median(ready.baseline),candidateReadyMedianMs:median(ready.candidate),samples,maxRegressionRatio,maxGraphDelayMs};
  log(JSON.stringify(summary));
  if(feeds.baseline.length||feeds.candidate.length){
    assert(feeds.baseline.length===samples&&feeds.candidate.length===samples,'Incomplete feed performance samples');
    summary.baselineFeedMedianMs=median(feeds.baseline);summary.candidateFeedMedianMs=median(feeds.candidate);
    log(JSON.stringify({event:'candidate_feed_performance',baselineMedianMs:summary.baselineFeedMedianMs,candidateMedianMs:summary.candidateFeedMedianMs,samples,maxRegressionRatio}));
    assert(summary.candidateFeedMedianMs<=summary.baselineFeedMedianMs*maxRegressionRatio,
      `Candidate feed readiness regressed: ${Math.round(summary.candidateFeedMedianMs)}ms versus ${Math.round(summary.baselineFeedMedianMs)}ms; existing traffic stays unchanged`);
  }
  assert(summary.candidateReadyMedianMs<=summary.baselineReadyMedianMs*maxRegressionRatio,
    `Candidate page readiness regressed: ${Math.round(summary.candidateReadyMedianMs)}ms versus ${Math.round(summary.baselineReadyMedianMs)}ms; existing traffic stays unchanged`);
  assert(summary.candidateMedianMs<=summary.baselineMedianMs+maxGraphDelayMs,
    `Candidate graph delay exceeds ${maxGraphDelayMs}ms budget: ${Math.round(summary.candidateMedianMs)}ms versus ${Math.round(summary.baselineMedianMs)}ms; existing traffic stays unchanged`);
  return summary;
}

async function run() {
  const {chromium}=await import('@playwright/test');
  try {
    await verifyCandidatePerformance({candidateUrl:process.env.CANDIDATE_URL,baselineUrl:process.env.BASELINE_URL,measure:async url=>{
      // Release the GPU process between samples, not just the page/context.
      const browser=await chromium.launch();
      let page;const errors=[];
      try {
        const context=await browser.newContext({viewport:{width:1440,height:1000}});
        page=await context.newPage();
        page.on('pageerror',error=>errors.push(error.message.slice(0,160)));
        await page.addInitScript(installGraphReadinessProbe);
        await page.goto(new URL('/en',url).href,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>window.__releaseGraphReadyAt!==null&&window.__releaseFeedReadyAt!==null,{},{timeout:45000});
        const duration=await page.evaluate(()=>({graphMs:window.__releaseGraphReadyAt,feedMs:window.__releaseFeedReadyAt}));
        await page.waitForTimeout(300);
        return duration;
      } catch(error) {
        const state=page?await Promise.race([
          page.evaluate(()=>({graphMs:window.__releaseGraphReadyAt,feedMs:window.__releaseFeedReadyAt,canvases:document.querySelectorAll('canvas').length,feeds:document.querySelectorAll('#intelligence-event-stream').length})).catch(()=>({unavailable:true})),
          new Promise(resolve=>setTimeout(()=>resolve({unresponsive:true}),2000)),
        ]):{pageUnavailable:true};
        console.error(JSON.stringify({event:'candidate_browser_readiness_failure',url,state,errors}));
        throw error;
      } finally {await browser.close();}
    }});
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  run().catch(error=>{console.error(error.message);process.exitCode=1;});
}
