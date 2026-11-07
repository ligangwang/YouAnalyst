import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import probe from './graph-readiness-probe.cjs';
import {navigateCandidatePage} from './verify-candidate-performance.mjs';
import {assetPrefix} from './publish-web-assets.mjs';
import {taggedReleaseRequest} from './tagged-release-request.mjs';

const candidate=process.env.CANDIDATE_URL,baseline=process.env.BASELINE_URL;
assert(candidate&&baseline&&process.env.GIT_SHA,'Candidate, predecessor and commit required');
// Authenticate only application-origin requests. CDN requests remain anonymous;
// a service identity must never be needed to retrieve public browser assets.
const token=execFileSync(process.platform==='win32'?'gcloud.cmd':'gcloud',['auth','print-identity-token',`--audiences=${baseline}`],{encoding:'utf8',shell:process.platform==='win32'}).trim();
for(const [label,documentUrl,assetBackend] of [['new-document-old-backend',candidate,baseline],['predecessor-document-retained-assets',baseline,candidate]]){
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    let websiteAssets=0,cdnAssets=0,allCdnAssets=0;const errors=[],badAssets=[];
    await context.route(`${new URL(documentUrl).origin}/**`,async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname.startsWith('/_next/static/')){
        websiteAssets++;
        const target=new URL(url.pathname+url.search,assetBackend).href;
        const result=await taggedReleaseRequest(target,{}, {request:async input=>{
          const response=await context.request.get(input,{headers:{Authorization:`Bearer ${token}`}});
          return {status:response.status(),response};
        }});
        return route.fulfill({response:result.response});
      }
      return route.continue({headers:{...request.headers(),Authorization:`Bearer ${token}`}});
    });
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{
      if(response.url().includes('/_next/static/')){
        if(new URL(response.url()).origin==='https://youanalyst-web-assets.web.app')allCdnAssets++;
        if(response.url().startsWith(assetPrefix(process.env.GIT_SHA)))cdnAssets++;
        if(response.status()!==200)badAssets.push({url:response.url(),status:response.status()});
      }
    });
    await page.addInitScript(probe.installGraphReadinessProbe);
    await navigateCandidatePage(page,new URL('/en',documentUrl).href);
    // The predecessor has a known independent feed-version bug. This check
    // requires its rendered graph and late module, not a repaired old feed.
    await page.waitForFunction(requireFeed=>window.__releaseGraphReadyAt!==null&&(!requireFeed||window.__releaseFeedReadyAt!==null),label==='new-document-old-backend',{timeout:45000});
    // Exercise a late-imported module too, after the initial graph is usable.
    await page.getByRole('tab',{name:'Company list',exact:true}).click();
    await page.locator('[data-list-company]').first().waitFor({state:'visible',timeout:20000});
    assert.deepEqual(errors,[],'Application failed while static requests target the opposite revision');
    assert.deepEqual(badAssets,[],'A cross-revision browser asset failed');
    if(label==='new-document-old-backend'){
      assert.equal(websiteAssets,0,'New HTML still requests revision-dependent assets');
      assert(cdnAssets>0,'New HTML did not load the release-pinned CDN assets');
    }else assert(websiteAssets+allCdnAssets>0,'Old document did not exercise retained assets');
    console.log(JSON.stringify({event:'cross_revision_assets_verified',label,websiteAssets,cdnAssets}));
  }finally{await browser.close();}
}
