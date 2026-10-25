import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {parseNewsRequest,processNewsRequest,publishNewsRequests,loadRequestedNewsSource,type NewsRequest} from '../../src/lib/intelligence/collectors/pubsub';
import type {NewsCursor,NewsStore} from '../../src/lib/intelligence/collectors/collector';
import type {NewsSource} from '../../src/lib/intelligence/collectors/sources';

const at=Date.parse('2026-10-23T12:00:00Z'),db={} as Firestore;
const source:NewsSource={id:'new-company-ir',companyId:'US:NEW',name:'New publisher',url:'https://ir.newcompany.com/news',allowedHosts:['ir.newcompany.com'],pollMs:3600000};
const message=(overrides:Partial<NewsRequest>={})=>parseNewsRequest({version:1,type:'news.source.collect.requested',batchId:'news_'+'a'.repeat(64),sourceId:source.id,companyId:source.companyId,requestedAt:new Date(at).toISOString(),...overrides});
const cursor=(overrides:Partial<NewsCursor>={}):NewsCursor=>({version:1,sourceId:source.id,baselineAt:null,lastSuccessAt:null,nextPollAt:new Date(at).toISOString(),failures:0,validators:{},itemIds:[],leaseId:'test',leaseUntil:new Date(at+120000).toISOString(),lastError:null,partial:false,...overrides});
function store(overrides:Partial<NewsStore>={}):NewsStore{return {acquire:async()=>cursor(),commit:async()=>({created:1,baseline:true}),fail:async()=>{},...overrides};}
const base={enabled:true,now:()=>at,source:async()=>source,readCursor:async()=>undefined};

test('queue envelopes cannot inject a fetch URL, path identity or another message type',()=>{
  assert.deepEqual(Object.keys(parseNewsRequest({...message(),url:'https://evil.invalid'})),Object.keys(message()));
  for(const input of [{...message(),version:2},{...message(),type:'other'},{...message(),sourceId:'../admin'},{...message(),companyId:'a/b'},{...message(),requestedAt:'invalid'},{...message(),batchId:'invalid'}])assert.throws(()=>parseNewsRequest(input));
});

test('publisher skips future polls and active leases without mutating cursors',async()=>{
  const sent:NewsRequest[]=[];
  const sources=[source,{...source,id:'later-ir'},{...source,id:'busy-ir'}];
  const result=await publishNewsRequests(sources,async request=>{sent.push(request);},{execution:'execution',now:()=>at,readCursor:async id=>id==='later-ir'?cursor({nextPollAt:new Date(at+1).toISOString()}):id==='busy-ir'?cursor():undefined});
  assert.equal(result.requested,1);assert.equal(result.skipped,2);assert.equal(sent[0].sourceId,source.id);
  const repeated:NewsRequest[]=[];
  await publishNewsRequests([source],async request=>{repeated.push(request);},{execution:'execution',now:()=>at,readCursor:async()=>undefined});
  assert.equal(repeated[0].batchId,sent[0].batchId);
});

test('failed publication does not prevent later companies being dispatched; fan-out is bounded',async()=>{
  let active=0,max=0;
  const sources=Array.from({length:40},(_,index)=>({...source,id:`source-${index}`}));
  const result=await publishNewsRequests(sources,async request=>{
    max=Math.max(max,++active);await new Promise(resolve=>setTimeout(resolve,1));active--;
    if(request.sourceId==='source-0')throw new Error('Provider unavailable');
  },{execution:'execution',now:()=>at,readCursor:async()=>undefined});
  assert.equal(result.requested,39);assert.equal(result.failed,1);assert.equal(max,8);
  assert.equal(result.errors[0].sourceId,'source-0');
});

test('publisher deadlines retain overdue sources for the next sweep',async()=>{
  const result=await publishNewsRequests([source],async()=>{throw new Error('Must not publish');},{execution:'execution',now:()=>at,deadline:at+29000,readCursor:async()=>{throw new Error('Must not read');}});
  assert.equal(result.deferred,1);assert.equal(result.failed,0);assert.equal(result.requested,0);
});

test('worker rereads current approval from the single owning company',async()=>{
  let status='PUBLISHED';
  const fake={collection:(name:string)=>{assert.equal(name,'companies');return {doc:(id:string)=>{
    assert.equal(id,source.companyId);return {get:async()=>({exists:true,id,data:()=>({name:'New',status:'DIRECTORY',onboarding:{status:'SUPPORTED'},themeIds:['ai'],themeMemberships:{ai:{status:'PUBLISHED'}},newsSources:[{...source,status,reviewedAt:'2026-10-22'}]})})};
  }}}} as unknown as Firestore;
  assert.equal((await loadRequestedNewsSource(fake,message()))?.id,source.id);
  status='WITHDRAWN';assert.equal(await loadRequestedNewsSource(fake,message()),undefined);
});

test('a newly onboarded database-only source uses normal collection and commits events',async()=>{
  let committed=0;
  const result=await processNewsRequest(message(),db,{...base,store:store({commit:async()=>{committed++;return {created:2,baseline:true};}}),read:async()=>({status:'modified',validators:{etag:'first'},page:{items:[],invalid:0,truncated:false}})});
  assert.equal(result.status,'verified');assert.equal('created' in result?result.created:undefined,2);assert.equal(committed,1);
});

test('successful fetches preserve validators and normal cursor/event commit behavior',async()=>{
  let committed=0;
  const result=await processNewsRequest(message(),db,{...base,store:store({acquire:async()=>cursor({baselineAt:new Date(at-3600000).toISOString(),validators:{etag:'original'}}),commit:async()=>{committed++;return {created:0,baseline:false};}}),read:async(_source,validators)=>{assert.equal(validators?.etag,'original');return {status:'unchanged'};}});
  assert.equal(result.status,'verified');assert.equal(committed,1);
});

test('duplicate delivery after success is acknowledged without fetching or reacquiring',async()=>{
  const result=await processNewsRequest(message(),db,{...base,readCursor:async()=>cursor({lastSuccessAt:new Date(at+1).toISOString()}),store:store({acquire:async()=>{throw new Error('Must not acquire');}})});
  assert.equal(result.duplicate,true);
});

test('failed publishers save backoff and request independent redelivery',async()=>{
  let failed=0;
  await assert.rejects(processNewsRequest(message(),db,{...base,store:store({fail:async(_source,_cursor,error,retry)=>{assert.equal(error,'HTTP 403');assert(retry.getTime()>at);failed++;}}),read:async()=>{throw new Error('HTTP 403');}}),/HTTP 403/);
  assert.equal(failed,1);
  await assert.rejects(processNewsRequest(message(),db,{...base,readCursor:async()=>cursor({leaseUntil:new Date(0).toISOString(),lastError:'HTTP 403',nextPollAt:new Date(at+3600000).toISOString()})}),/cooling down/);
});

test('leases and acquisition races retry instead of acknowledging unfinished work',async()=>{
  await assert.rejects(processNewsRequest(message(),db,{...base,readCursor:async()=>cursor()}),/busy/);
  await assert.rejects(processNewsRequest(message(),db,{...base,store:store({acquire:async()=>null})}),/busy/);
});

test('disabled workers retain tasks and withdrawn sources never fetch',async()=>{
  await assert.rejects(processNewsRequest(message(),db,{...base,enabled:false}),/disabled/);
  assert.equal((await processNewsRequest(message(),db,{...base,source:async()=>undefined})).status,'ineligible');
  await assert.rejects(processNewsRequest(message(),db,{...base,source:async()=>({...source,companyId:'US:OTHER'})}),/identity mismatch/);
});
