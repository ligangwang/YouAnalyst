import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyCompanySearchWriters} from '../../src/lib/market-companies/search-writer-guard';
const sha='a'.repeat(40),options={project:'fixture-project',expectedSha:sha,token:'fixture'};
function fixture(change:(url:string,value:Record<string,unknown>)=>void=()=>{}){
 const urls:string[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input);urls.push(url);assert.equal(init?.method,undefined);
  const name=url.includes('ticker-catalog-subscriber')?'ticker-catalog-subscriber':'cni-directory-subscriber';
  const container={image:name.includes('ticker')?'financial-image':'directory-image',env:[{name:'GIT_SHA',value:sha}]};
  const value:Record<string,unknown>=url.includes('/revisions/')?{containers:[container]}:url.endsWith('/'+name)?{generation:'2',observedGeneration:'2',terminalCondition:{state:'CONDITION_SUCCEEDED'},latestReadyRevision:'ready',latestCreatedRevision:'ready',template:{containers:[container]},trafficStatuses:[{revision:name+'-00002-new',percent:100}]}:url.includes('/executions?')?{executions:[]}:url.endsWith('/jobs/sync-cni-directory-production')?{template:{template:{containers:[{image:'directory-image'}]}}}:{fields:{}};
  change(url,value);return Response.json(value);
 };
 return {fetcher,urls};
}
test('cleanup verifies both live writer revisions, publisher image and inactive leases without changing cloud state',async()=>{
 const f=fixture();await verifyCompanySearchWriters(options,f.fetcher);assert.equal(f.urls.length,8);
});
for(const service of ['ticker-catalog-subscriber','cni-directory-subscriber'])test(`cleanup blocks stale ${service} traffic even with a current template`,async()=>{
 const f=fixture((url,value)=>{if(url.includes(service+'/revisions/'))value.containers=[{image:service.includes('ticker')?'financial-image':'directory-image',env:[{name:'GIT_SHA',value:'b'.repeat(40)}]}];});
 await assert.rejects(verifyCompanySearchWriters(options,f.fetcher),/older writer revision/);
});
test('cleanup blocks incomplete rollout, old publisher executions, active leases and missing metadata access',async()=>{
 for(const [change,pattern] of [
  [(url:string,value:Record<string,unknown>)=>{if(url.endsWith('/ticker-catalog-subscriber'))value.reconciling=true;},/completed rollout/],
  [(url:string,value:Record<string,unknown>)=>{if(url.includes('/executions?'))value.executions=[{template:{containers:[{image:'old-image'}]}}];},/older directory execution/],
  [(url:string,value:Record<string,unknown>)=>{if(url.endsWith('/CN_A_CNI'))value.fields={leaseExpiresAtMs:{integerValue:String(Date.now()+60000)}};},/writer is busy/],
 ] as const){await assert.rejects(verifyCompanySearchWriters(options,fixture(change).fetcher),pattern);}
 await assert.rejects(verifyCompanySearchWriters(options,async()=>new Response('',{status:403})),/HTTP 403/);
});

test('cleanup permits the retired ticker subscriber to be absent while verifying directory writers', async()=>{
 const f=fixture();
 const fetcher:typeof fetch=async(input,init)=>String(input).endsWith('/services/ticker-catalog-subscriber')?new Response(null,{status:404}):f.fetcher(input,init);
 await verifyCompanySearchWriters(options,fetcher);
 assert.ok(f.urls.some(url=>url.includes('/services/cni-directory-subscriber/revisions/')));
});
