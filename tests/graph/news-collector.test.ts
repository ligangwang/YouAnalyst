import assert from 'node:assert/strict';
import test from 'node:test';
import type {Firestore} from 'firebase-admin/firestore';
import {NEWS_SOURCES} from '../../src/lib/intelligence/collectors/sources';
import {approvedNewsUrl,fetchNews,parseNewsFeed,MAX_FEED_BYTES,NewsFetchError,type NewsResponse} from '../../src/lib/intelligence/collectors/news';
import {firestoreNewsStore,NEWS_EVENTS_COLLECTION,NEWS_COLLECTORS_COLLECTION} from '../../src/lib/intelligence/collectors/store';
import {collectNewsSources} from '../../src/lib/intelligence/collectors/collector';
import {projectCollectedNews} from '../../src/lib/intelligence/collectors/projection';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import {EVENTS_COLLECTION,eventDocumentId} from '../../src/lib/events/model';

const source=NEWS_SOURCES[0],at=new Date('2026-10-02T16:00:00Z');
const rss=(items:string)=>`<rss version="2.0"><channel>${items}</channel></rss>`;
const entry=(id:string)=>`<item><title>Announcement ${id}</title><link>https://nvidianews.nvidia.com/releases/${id}</link><pubDate>Fri, 02 Oct 2026 12:00:00 +0000</pubDate><description><![CDATA[<p>Company update</p>]]></description></item>`;
test('verified article aliases use the public canonical host without allowing fetch redirects to that alias',()=>{
  const core=NEWS_SOURCES.find(source=>source.id==='coreweave-news')!;
  assert.equal(approvedNewsUrl('https://wf.coreweave.com/blog/a',core,true),'https://www.coreweave.com/blog/a');
  assert.equal(approvedNewsUrl('https://wf.coreweave.com/blog/a',core),null);
  assert.equal(approvedNewsUrl('https://fake.coreweave.com/blog/a',core,true),null);
  assert.equal(approvedNewsUrl('https://nvidianews.nvidia.com/a?x=1&amp;y=2',source),'https://nvidianews.nvidia.com/a?x=1&y=2');
});
test('official RSS is canonicalized, markup is stripped, and the publisher timezone is retained',()=>{
  const page=parseNewsFeed(rss(entry('a')+'<item><title>AMD &amp; NVIDIA</title><link>https://nvidianews.nvidia.com/releases/b?utm_source=x</link><pubDate>2026-10-01</pubDate></item>'+entry('a')),source);
  assert.equal(page.items.length,2);assert.equal(page.items[0].publishedAt,'2026-10-02T12:00:00.000Z');assert.equal(page.items[0].summary,'Company update');
  assert.equal(page.items[1].title,'AMD & NVIDIA');assert.equal(page.items[1].url,'https://nvidianews.nvidia.com/releases/b');assert.equal(page.items[1].publishedAt,null);
});
test('Atom chooses the article link instead of its self link; missing timezone stays unknown',()=>{
  const xml='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Update</title><link rel="self" href="https://nvidianews.nvidia.com/feed"/><link rel="alternate" href="https://nvidianews.nvidia.com/article"/><published>2026-10-02T12:00:00</published></entry></feed>';
  const page=parseNewsFeed(xml,source);assert.equal(page.items[0].url,'https://nvidianews.nvidia.com/article');assert.equal(page.items[0].publishedAt,null);
});
test('malformed XML, entities, non-feeds, oversized responses and unapproved article hosts are rejected',()=>{
  for(const xml of ['<rss>', '<html/>','<rss/>','<!DOCTYPE rss [<!ENTITY x "hello">]><rss/>'])assert.throws(()=>parseNewsFeed(xml,source));
  assert.throws(()=>parseNewsFeed(' '.repeat(MAX_FEED_BYTES+1),source));
  const page=parseNewsFeed(rss('<item><title>Bad</title><link>https://evil.example/a</link></item><item><title>Bad</title><link>http://nvidianews.nvidia.com/a</link></item>'),source);
  assert.equal(page.invalid,2);assert.equal(page.items.length,0);
});
test('item cap is explicit, rather than claiming full feed coverage',()=>{
  const page=parseNewsFeed(rss(Array.from({length:101},(_,i)=>entry(String(i))).join('')),source);assert.equal(page.items.length,100);assert.equal(page.truncated,true);
});
test('conditional fetches retain validators and treat 304 as unchanged',async()=>{
  const request:typeof fetch=async(_url,options)=>{assert.equal((options?.headers as Record<string,string>)['If-None-Match'],'etag');return new Response(null,{status:304});};
  assert.deepEqual(await fetchNews(source,{etag:'etag'},request),{status:'unchanged'});
  const response=await fetchNews(source,{},async()=>new Response(rss(entry('a')),{headers:{etag:'new'}}));assert.equal(response.status,'modified');if(response.status==='modified')assert.equal(response.validators.etag,'new');
});
test('redirects cannot escape publisher hosts and rate limits preserve Retry-After',async()=>{
  let calls=0;await assert.rejects(fetchNews(source,{},async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}});}),/Unapproved/);assert.equal(calls,1);
  await assert.rejects(fetchNews(source,{},async()=>new Response(null,{status:429,headers:{'retry-after':'7200'}})),error=>error instanceof NewsFetchError&&error.retryAfterMs===7_200_000);
  await assert.rejects(fetchNews(source,{},async()=>new Response('x'.repeat(MAX_FEED_BYTES+1))),/size limit/);
});

/** Exercise the real transaction code with atomic writes and document snapshots. */
function memoryDb(){
  const records=new Map<string,Record<string,unknown>>();
  const snapshot=(ref:{path:string})=>({exists:records.has(ref.path),data:()=>records.get(ref.path)});
  const db={collection:(name:string)=>({doc:(id:string)=>({path:`${name}/${id}`})}),runTransaction:async<T>(run:(tx:unknown)=>Promise<T>)=>{
    const writes:(()=>void)[]=[];
    const value=await run({get:async(ref:{path:string})=>snapshot(ref),getAll:async(...refs:{path:string}[])=>refs.map(snapshot),set:(ref:{path:string},data:Record<string,unknown>)=>writes.push(()=>records.set(ref.path,data)),create:(ref:{path:string},data:Record<string,unknown>)=>{assert.equal(records.has(ref.path),false);writes.push(()=>records.set(ref.path,data));}});
    writes.forEach(write=>write());return value;
  }};
  return {db:db as unknown as Firestore,records};
}
const page=(id:string):NewsResponse=>({status:'modified',page:parseNewsFeed(rss(entry(id)),source),validators:{etag:id}});
test('initial history starts on January 1, 2026 and older publications never resurface as new arrivals',async()=>{
  const {db,records}=memoryDb(),store=firestoreNewsStore(db);
  const response=page('cutoff');assert.equal(response.status,'modified');if(response.status!=='modified')return;
  const sample=response.page.items[0];
  const historical:NewsResponse={...response,page:{items:[{...sample,id:'a'.repeat(64),publishedDate:'2025-12-31'},{...sample,id:'b'.repeat(64),publishedDate:'2026-01-01'},{...sample,id:'c'.repeat(64),publishedDate:null,publishedAt:null}],invalid:0,truncated:false}};
  const first=await store.acquire(source,at,'first');assert.ok(first);await store.commit(source,first,historical,at);
  assert.equal([...records.keys()].filter(key=>key.startsWith('events/')).length,1);
  assert.equal(records.get(`events/${eventDocumentId('company_news','b'.repeat(64))}`)?.baseline,true);
  const nextAt=new Date(at.getTime()+source.pollMs),next=await store.acquire(source,nextAt,'next');assert.ok(next);
  await store.commit(source,next,{...response,page:{items:[{...sample,id:'d'.repeat(64),publishedDate:'2025-12-31'},{...sample,id:'e'.repeat(64),publishedDate:null,publishedAt:null}],invalid:0,truncated:false}},nextAt);
  assert.equal(records.has(`events/${eventDocumentId('company_news','d'.repeat(64))}`),false);
  assert.equal(records.get(`events/${eventDocumentId('company_news','e'.repeat(64))}`)?.firstObservedAt,nextAt.toISOString());
});
test('successful hourly scans stay due at the next hour despite completion jitter',async()=>{
  const {db,records}=memoryDb(),store=firestoreNewsStore(db),completion=new Date('2026-10-02T16:00:20Z');
  const cursor=await store.acquire(source,at,'first');assert.ok(cursor);await store.commit(source,cursor,page('history'),completion);
  assert.equal(records.get(`${NEWS_COLLECTORS_COLLECTION}/${source.id}`)?.nextPollAt,'2026-10-02T17:00:00.000Z');
  assert.ok(await store.acquire(source,new Date('2026-10-02T17:00:01Z'),'next'));
});
test('the shared events collection preserves other event kinds and keeps the news projection typed',async()=>{
  const {db,records}=memoryDb(),store=firestoreNewsStore(db),response=page('shared');assert.equal(response.status,'modified');
  if(response.status!=='modified')return;
  const item=response.page.items[0],otherId=eventDocumentId('sec_filing',item.id);
  const other={...item,id:otherId,version:1,type:'sec_filing',sourceType:'sec',companyIds:[source.companyId],baseline:false,firstObservedAt:at.toISOString()};
  records.set(`${EVENTS_COLLECTION}/${otherId}`,other);
  const cursor=await store.acquire(source,at,'news');assert.ok(cursor);await store.commit(source,cursor,response,at);
  assert.equal(NEWS_EVENTS_COLLECTION,'events');assert.equal(records.get(`${EVENTS_COLLECTION}/${otherId}`),other);
  const news=records.get(`${EVENTS_COLLECTION}/${eventDocumentId('company_news',item.id)}`)!;
  assert.equal(news.type,'company_news');assert.equal(news.sourceType,'company_ir');assert.deepEqual(news.companyIds,[source.companyId]);
  const graph:KnowledgeGraph={nodes:[{id:source.companyId,kind:'COMPANY',order:0}],relationships:[],sources:[],asOf:'2026-10-02'};
  assert.equal(projectCollectedNews([other,{...news,baseline:false}],graph,at).length,1);
  assert.equal(projectCollectedNews([{...news,baseline:false,sourceType:'sec'}],graph,at).length,0);
});
test('initial history remains baseline; later arrivals are immutable and retries do not duplicate them',async()=>{
  const {db,records}=memoryDb(),store=firestoreNewsStore(db);
  const first=await store.acquire(source,at,'first');assert.ok(first);assert.equal(await store.acquire(source,at,'other'),null);
  await store.commit(source,first,page('history'),at);
  const nextAt=new Date(at.getTime()+source.pollMs),next=await store.acquire(source,nextAt,'next');assert.ok(next);
  await store.commit(source,next,page('new'),nextAt);
  const values=[...records.entries()].filter(([key])=>key.startsWith(NEWS_EVENTS_COLLECTION+'/')).map(([,value])=>value);
  assert.equal(values.length,2);assert.equal(values[0].baseline,true);assert.equal(values[1].baseline,false);assert.equal(values[1].firstObservedAt,nextAt.toISOString());
  const retryAt=new Date(nextAt.getTime()+source.pollMs),retry=await store.acquire(source,retryAt,'retry');assert.ok(retry);await store.commit(source,retry,page('new'),retryAt);
  assert.equal(values[1].firstObservedAt,nextAt.toISOString());assert.equal(records.size,3);
  const graph:KnowledgeGraph={nodes:[{id:source.companyId,kind:'COMPANY',order:0}],relationships:[],sources:[],asOf:'2026-10-02'};
  const projected=projectCollectedNews(values,graph,retryAt);assert.equal(projected.length,1);assert.equal(projected[0].observedAt,nextAt.toISOString());assert.deepEqual(projected[0].edgeIds,[]);
});
test('failed scans keep their previous validators and first-seen state; stale leases cannot commit',async()=>{
  const {db,records}=memoryDb(),store=firestoreNewsStore(db),first=await store.acquire(source,at,'first');assert.ok(first);
  await store.commit(source,first,page('history'),at);
  const nextAt=new Date(at.getTime()+source.pollMs),next=await store.acquire(source,nextAt,'next');assert.ok(next);
  await assert.rejects(store.commit(source,next,page('bad'),new Date(nextAt.getTime()+121_000)),/lease expired/);
  await store.fail(source,next,'HTTP 429',new Date(nextAt.getTime()+1_200_000));
  const state=records.get(`${NEWS_COLLECTORS_COLLECTION}/${source.id}`)!;assert.deepEqual(state.validators,{etag:'history'});assert.equal(state.lastSuccessAt,at.toISOString());assert.equal(state.failures,1);assert.equal(records.size,2);
});
test('runner respects provider backoff without losing prior collector health',async()=>{
  const {db,records}=memoryDb();await collectNewsSources([source],firestoreNewsStore(db),async()=>{throw new NewsFetchError('HTTP 429',7_200_000);},()=>at);
  assert.equal(records.get(`${NEWS_COLLECTORS_COLLECTION}/${source.id}`)?.nextPollAt,new Date(at.getTime()+7_200_000).toISOString());
});
