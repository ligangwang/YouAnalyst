import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import probe from './graph-readiness-probe.cjs';
import {taggedReleaseRequest} from './tagged-release-request.mjs';
const {installGraphReadinessProbe}=probe;

const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];

/** A completed error document is not an application timing sample. */
export async function navigateCandidatePage(page,url,{sleep,log}={}){
  const response=await taggedReleaseRequest(url,{method:'GET'},{sleep,log,request:async target=>{
    const navigation=await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
    assert(navigation,'Candidate navigation returned no HTTP response');
    return {status:navigation.status()};
  }});
  assert.equal(response.status,200,`Browser navigation returned HTTP ${response.status}; existing traffic stays unchanged`);
  return response.status;
}

/** Interleave fresh browser contexts so deployment warmth/order cannot choose a winner. */
export async function verifyCandidatePerformance({candidateUrl,baselineUrl,measure,samples=5,maxRegressionRatio=1.1,maxGraphDelayMs=1000,log=console.log}) {
  assert(candidateUrl&&baselineUrl&&typeof measure==='function');
  assert(Number.isInteger(samples)&&samples>=3&&samples%2===1);
  assert(Number.isFinite(maxGraphDelayMs)&&maxGraphDelayMs>=0);
  const urls={baseline:baselineUrl,candidate:candidateUrl},results={baseline:[],candidate:[]},feeds={baseline:[],candidate:[]},ready={baseline:[],candidate:[]},readyUpper={baseline:[],candidate:[]},feedsUpper={baseline:[],candidate:[]},timeouts={baseline:0,candidate:0};
  const timing=async(label)=>{
    const measured=await measure(urls[label],label),value=typeof measured==='number'?{graphMs:measured}:measured;
    assert(!(label==='candidate'&&value.feedTimedOut),'Candidate feed failed to settle; existing traffic stays unchanged');
    return value;
  };
  for(const label of ['baseline','candidate']){const value=await timing(label);log(JSON.stringify({event:'candidate_browser_warmup',label,durationMs:value.graphMs,feedDurationMs:value.feedMs,...(value.feedTimedOut?{feedTimedOut:true,feedTimeIsLowerBound:true}:{})}));}
  for(let round=0;round<samples;round++) {
    for(const label of round%2?['candidate','baseline']:['baseline','candidate']) {
      const {graphMs:durationMs,feedMs,feedTimedOut}=await timing(label);
      assert(Number.isFinite(durationMs)&&durationMs>0,'Invalid browser timing');
      results[label].push(durationMs);
      if(feedMs!==undefined){assert(Number.isFinite(feedMs)&&feedMs>0,'Invalid feed timing');feeds[label].push(feedMs);feedsUpper[label].push(feedTimedOut?Infinity:feedMs);}
      ready[label].push(Math.max(durationMs,feedMs??durationMs));
      readyUpper[label].push(feedTimedOut?Infinity:Math.max(durationMs,feedMs??durationMs));
      if(feedTimedOut)timeouts[label]++;
      log(JSON.stringify({event:'candidate_browser_sample',label,round:round+1,durationMs,feedDurationMs:feedMs,...(feedTimedOut?{feedTimedOut:true,feedTimeIsLowerBound:true}:{})}));
    }
  }
  const summary={event:'candidate_browser_performance',baselineMedianMs:median(results.baseline),candidateMedianMs:median(results.candidate),baselineReadyMedianMs:median(ready.baseline),candidateReadyMedianMs:median(ready.candidate),baselineFeedTimeouts:timeouts.baseline,baselineReadyMedianIsLowerBound:median(ready.baseline)!==median(readyUpper.baseline),samples,maxRegressionRatio,maxGraphDelayMs};
  log(JSON.stringify(summary));
  if(feeds.baseline.length||feeds.candidate.length){
    assert(feeds.baseline.length===samples&&feeds.candidate.length===samples,'Incomplete feed performance samples');
    summary.baselineFeedMedianMs=median(feeds.baseline);summary.candidateFeedMedianMs=median(feeds.candidate);
    summary.baselineFeedMedianIsLowerBound=summary.baselineFeedMedianMs!==median(feedsUpper.baseline);
    log(JSON.stringify({event:'candidate_feed_performance',baselineMedianMs:summary.baselineFeedMedianMs,candidateMedianMs:summary.candidateFeedMedianMs,baselineFeedTimeouts:timeouts.baseline,baselineMedianIsLowerBound:summary.baselineFeedMedianIsLowerBound,samples,maxRegressionRatio}));
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
    await verifyCandidatePerformance({candidateUrl:process.env.CANDIDATE_URL,baselineUrl:process.env.BASELINE_URL,measure:async(url,label)=>{
      // Release the GPU process between samples, not just the page/context.
      const browser=await chromium.launch();
      let page,navigationStatus;const errors=[];
      try {
        const context=await browser.newContext({viewport:{width:1440,height:1000}});
        page=await context.newPage();
        page.on('pageerror',error=>{if(errors.length<20)errors.push(error.message.slice(0,160));});
        page.on('requestfailed',request=>{if(errors.length<20)errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText??'request failed'}`.slice(0,180));});
        await page.addInitScript(installGraphReadinessProbe);
        navigationStatus=await navigateCandidatePage(page,new URL('/en',url).href);
        await page.waitForFunction(()=>window.__releaseGraphReadyAt!==null&&window.__releaseFeedReadyAt!==null,{},{timeout:45000});
        const duration=await page.evaluate(()=>({graphMs:window.__releaseGraphReadyAt,feedMs:window.__releaseFeedReadyAt}));
        await page.waitForTimeout(300);
        return duration;
      } catch(error) {
        const state=page?await Promise.race([
          page.evaluate(()=>({elapsedMs:performance.now(),title:document.title,body:document.body?.innerText.slice(0,240),graphMs:window.__releaseGraphReadyAt,feedMs:window.__releaseFeedReadyAt,canvases:document.querySelectorAll('canvas').length,feeds:document.querySelectorAll('#intelligence-event-stream').length,scripts:document.scripts.length})).catch(()=>({unavailable:true})),
          new Promise(resolve=>setTimeout(()=>resolve({unresponsive:true}),2000)),
        ]):{pageUnavailable:true};
        console.error(JSON.stringify({event:'candidate_browser_readiness_failure',url,navigationStatus:navigationStatus??error.actual,state,errors}));
        // A known broken serving feed must not prevent its repair. Preserve
        // its actual observation window as a right-censored lower bound, never
        // a successful sample or a dropped visit. Candidate failures still fail.
        if(label==='baseline'&&error.name==='TimeoutError'&&navigationStatus===200&&state.canvases>0&&Number.isFinite(state.graphMs)&&state.graphMs>0&&state.feedMs===null&&state.elapsedMs>=45000){
          return {graphMs:state.graphMs,feedMs:state.elapsedMs,feedTimedOut:true};
        }
        throw error;
      } finally {await browser.close();}
    }});
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  run().catch(error=>{console.error(error.message);process.exitCode=1;});
}
