import assert from 'node:assert/strict';
import test from 'node:test';
import type {Firestore} from 'firebase-admin/firestore';
import {NEWS_SOURCES} from '../../src/lib/intelligence/collectors/sources';
import {articlePublicationDay,approvedNewsUrl,fetchNews,parseNewsFeed,MAX_FEED_BYTES,NewsFetchError,type NewsResponse} from '../../src/lib/intelligence/collectors/news';
import {firestoreNewsStore,NEWS_EVENTS_COLLECTION,NEWS_COLLECTORS_COLLECTION} from '../../src/lib/intelligence/collectors/store';
import {collectNewsSources} from '../../src/lib/intelligence/collectors/collector';
import {projectCollectedNews,newsCollectorIsFresh} from '../../src/lib/intelligence/collectors/projection';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import {EVENTS_COLLECTION,eventDocumentId} from '../../src/lib/events/model';

const source=NEWS_SOURCES[0],at=new Date('2026-10-02T16:00:00Z');
const rss=(items:string)=>`<rss version="2.0"><channel>${items}</channel></rss>`;
const entry=(id:string)=>`<item><title>Announcement ${id}</title><link>https://nvidianews.nvidia.com/releases/${id}</link><pubDate>Fri, 02 Oct 2026 12:00:00 +0000</pubDate><description><![CDATA[<p>Company update</p>]]></description></item>`;

test('reviewed relative article links retain earnings PDFs and reject unapproved hosts',()=>{
  const publisher=NEWS_SOURCES.find(source=>source.id==='cgnx-ir')!;
  const item=(link:string)=>`<item><title>Quarterly results</title><link>${link}</link><pubDate>Wed, 05 Aug 2026 16:30:00 -0400</pubDate></item>`;
  const page=parseNewsFeed(rss(item('/files/doc_earnings/2026/q2/results.pdf')+item('//evil.example/results.pdf')),publisher);
  assert.equal(page.invalid,1);assert.equal(page.items.length,1);
  assert.equal(page.items[0].url,'https://investor.cognex.com/files/doc_earnings/2026/q2/results.pdf');
  assert.equal(page.items[0].published_at,'2026-08-05T20:30:00.000Z');
  assert.equal(parseNewsFeed(rss(item('/files/results.pdf')),source).items.length,0);
});

test('publisher Media entries and confirmed legacy attachment children do not inflate article activity',()=>{
  const skhy=NEWS_SOURCES.find(source=>source.id==='skhy-ir')!;
  const item=(path:string,category:string)=>`<item><title>SK hynix Ventures story</title><link>https://news.skhynix.com/en/${path}/</link><category>${category}</category><pubDate>Fri, 02 Oct 2026 01:00:00 GMT</pubDate></item>`;
  const page=parseNewsFeed(rss(item('ventures-story','STORY')+item('ventures-story-1','Media')+item('fact-11','FACT')),skhy);
  assert.equal(page.items.length,2);assert.equal(page.invalid,0);
  assert(page.items.some(row=>row.url.endsWith('/fact-11/')));
  const main=page.items[0],record={...main,version:1,type:'company_news',sourceType:'company_ir',companyIds:[skhy.companyId]};
  const attachment={...record,id:'attachment',url:main.url.replace('/ventures-story/','/ventures-story-1/')};
  const graph:KnowledgeGraph={nodes:[{id:skhy.companyId,kind:'COMPANY',order:0}],relationships:[],sources:[],asOf:'2026-10-02'};
  const projected=projectCollectedNews([record,attachment],graph,at);
  assert.equal(projected.length,1);assert.equal(projected[0].evidence[0].url,main.url);
  // A numbered real article with no matching parent is preserved.
  assert.equal(projectCollectedNews([{...attachment,title:'Different story'}],graph,at).length,1);
});

test('CMS rebuild timestamps never become original CoreWeave publication times',async()=>{
  const core=NEWS_SOURCES.find(source=>source.id==='coreweave-news')!;
  const xml=rss('<item><title>Historic article</title><link>https://wf.coreweave.com/blog/old</link><pubDate>Fri, 02 Oct 2026 14:12:41 GMT</pubDate></item>');
  const raw=parseNewsFeed(xml,core);assert.equal(raw.items[0].published_at,null);assert.equal(raw.items[0].publication_date,null);
  const html='<script type="application/ld+json">{"datePublished":"2026-10-02T14:12:41Z"}</script><div class="article-date-wrapper"><div>Published on</div><div>June 27, 2023</div></div>';
  assert.equal(articlePublicationDay(html),'2023-06-27');assert.equal(articlePublicationDay(html.replace('June 27, 2023','February 30, 2026')),null);assert.equal(articlePublicationDay('<script>{"datePublished":"2026-10-02T14:12:41Z"}</script>'),null);
  let articleRequests=0;
  const request:typeof fetch=async url=>{if(String(url).endsWith('rss.xml'))return new Response(xml);articleRequests++;return new Response(html);};
  const response=await fetchNews(core,{},request);assert.equal(response.status,'modified');if(response.status==='modified'){assert.equal(response.page.items[0].publication_date,'2023-06-27');assert.equal(response.page.items[0].published_at,null);}
  assert.equal(articleRequests,1);
  await fetchNews(core,{},request,[raw.items[0].id]);assert.equal(articleRequests,1);
  await assert.rejects(fetchNews(core,{},async url=>String(url).endsWith('rss.xml')?new Response(xml):new Response(null,{status:302,headers:{location:'https://evil.example/article'}})),/Unapproved article host/);
});
test('verified article aliases use the public canonical host without allowing fetch redirects to that alias',()=>{
  const core=NEWS_SOURCES.find(source=>source.id==='coreweave-news')!;
  assert.equal(approvedNewsUrl('https://wf.coreweave.com/blog/a',core,true),'https://www.coreweave.com/blog/a');
  assert.equal(approvedNewsUrl('https://wf.coreweave.com/blog/a',core),null);
  assert.equal(approvedNewsUrl('https://fake.coreweave.com/blog/a',core,true),null);
  assert.equal(approvedNewsUrl('https://nvidianews.nvidia.com/a?x=1&amp;y=2',source),'https://nvidianews.nvidia.com/a?x=1&y=2');
});
test('official RSS is canonicalized, markup is stripped, and the publisher timezone is retained',()=>{
  const page=parseNewsFeed(rss(entry('a')+'<item><title>AMD &amp; NVIDIA</title><link>https://nvidianews.nvidia.com/releases/b?utm_source=x</link><pubDate>2026-10-01</pubDate></item>'+entry('a')),source);
  assert.equal(page.items.length,2);assert.equal(page.items[0].published_at,'2026-10-02T12:00:00.000Z');assert.equal(page.items[0].summary,'Company update');
  assert.equal(page.items[1].title,'AMD & NVIDIA');assert.equal(page.items[1].url,'https://nvidianews.nvidia.com/releases/b');assert.equal(page.items[1].published_at,null);
});
test('Atom chooses the article link instead of its self link; missing timezone stays unknown',()=>{
  const xml='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Update</title><link rel="self" href="https://nvidianews.nvidia.com/feed"/><link rel="alternate" href="https://nvidianews.nvidia.com/article"/><published>2026-10-02T12:00:00</published></entry></feed>';
  const page=parseNewsFeed(xml,source);assert.equal(page.items[0].url,'https://nvidianews.nvidia.com/article');assert.equal(page.items[0].published_at,null);
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
  const historical:NewsResponse={...response,page:{items:[{...sample,id:'a'.repeat(64),publication_date:'2025-12-31'},{...sample,id:'b'.repeat(64),publication_date:'2026-01-01'},{...sample,id:'c'.repeat(64),publication_date:null,published_at:null}],invalid:0,truncated:false}};
  const first=await store.acquire(source,at,'first');assert.ok(first);await store.commit(source,first,historical,at);
  assert.equal([...records.keys()].filter(key=>key.startsWith('events/')).length,1);
  assert.equal(records.get(`events/${eventDocumentId('company_news','b'.repeat(64))}`)?.baseline,true);
  const nextAt=new Date(at.getTime()+source.pollMs),next=await store.acquire(source,nextAt,'next');assert.ok(next);
  await store.commit(source,next,{...response,page:{items:[{...sample,id:'d'.repeat(64),publication_date:'2025-12-31'},{...sample,id:'e'.repeat(64),publication_date:null,published_at:null}],invalid:0,truncated:false}},nextAt);
  assert.equal(records.has(`events/${eventDocumentId('company_news','d'.repeat(64))}`),false);
  assert.equal(records.get(`events/${eventDocumentId('company_news','e'.repeat(64))}`)?.collected_at,nextAt.toISOString());
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
  const other={...item,id:otherId,version:1,type:'sec_filing',sourceType:'sec',companyIds:[source.companyId],baseline:false,collected_at:at.toISOString()};
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
  assert.equal(values.length,2);assert.equal(values[0].baseline,true);assert.equal(values[1].baseline,false);assert.equal(values[1].collected_at,nextAt.toISOString());
  const retryAt=new Date(nextAt.getTime()+source.pollMs),retry=await store.acquire(source,retryAt,'retry');assert.ok(retry);await store.commit(source,retry,page('new'),retryAt);
  assert.equal(values[1].collected_at,nextAt.toISOString());assert.equal(records.size,3);
  const graph:KnowledgeGraph={nodes:[{id:source.companyId,kind:'COMPANY',order:0}],relationships:[],sources:[],asOf:'2026-10-02'};
  const projected=projectCollectedNews(values,graph,retryAt);assert.equal(projected.length,2);assert.equal(projected[0].published_at,'2026-10-02T12:00:00.000Z');assert.equal('collected_at' in projected[0],false);assert.equal('processed_at' in projected[0],false);assert.deepEqual(projected[0].edgeIds,[]);
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

test('publication time owns replay even when collection is delayed; operational fields stay private',()=>{
  const graph:KnowledgeGraph={nodes:[{id:source.companyId,kind:'COMPANY',order:0}],relationships:[],sources:[],asOf:'2026-10-02'};
  const item=parseNewsFeed(rss(entry('delayed')),source).items[0];
  const record={...item,id:'delayed',version:1,type:'company_news',sourceType:'company_ir',companyIds:[source.companyId],baseline:true,collected_at:'2026-10-02T16:00:00Z',processed_at:'2026-10-02T16:00:03Z'};
  const [event]=projectCollectedNews([record],graph,at);
  assert.equal(event.published_at,'2026-10-02T12:00:00.000Z');
  assert.equal('collected_at' in event,false);assert.equal('processed_at' in event,false);
  const [dateOnly]=projectCollectedNews([{...record,published_at:null,publication_date:'2026-10-01'}],graph,at);
  assert.equal(dateOnly.published_at,null);assert.equal(dateOnly.publication_date,'2026-10-01');
  assert.equal(projectCollectedNews([{...record,published_at:null,publication_date:null}],graph,at).length,0);
});

test('collection and normalization completion are stored separately and survive retries',async()=>{
  const {db,records}=memoryDb(),store=firestoreNewsStore(db),cursor=await store.acquire(source,at,'first');assert.ok(cursor);
  const response=page('timed');if(response.status!=='modified')throw new Error('Expected response');
  await store.commit(source,cursor,{...response,collected_at:'2026-10-02T15:59:58.000Z'},at);
  const record=[...records.entries()].find(([key])=>key.startsWith('events/'))![1];
  assert.equal(record.published_at,'2026-10-02T12:00:00.000Z');
  assert.equal(record.collected_at,'2026-10-02T15:59:58.000Z');assert.equal(record.processed_at,at.toISOString());
});


test('weekday hourly collector health remains valid through weekend pauses',()=>{
  const hour=3_600_000,success='2026-10-03T03:00:05Z'; // Friday 23:00 ET
  assert.equal(newsCollectorIsFresh(success,0,false,new Date('2026-10-04T16:00:00Z'),hour),true);
  assert.equal(newsCollectorIsFresh(success,0,false,new Date('2026-10-05T08:00:00Z'),hour),false);
  assert.equal(newsCollectorIsFresh(success,1,false,new Date('2026-10-04T16:00:00Z'),hour),false);
  assert.equal(newsCollectorIsFresh(success,0,true,new Date('2026-10-04T16:00:00Z'),hour),false);
  assert.equal(newsCollectorIsFresh('2026-10-04T17:00:00Z',0,false,new Date('2026-10-04T16:00:00Z'),hour),false);
});
test('Apple article date owns publication; Atom update time never becomes publication',async()=>{
  const apple=NEWS_SOURCES.find(source=>source.id==='apple-news')!;
  const xml='<feed><entry><title>Update</title><link href="https://www.apple.com/newsroom/article"/><updated>2026-10-02T15:00:00Z</updated></entry></feed>';
  const html='<script>{"dateModified":"2026-10-02T15:00:00Z"}</script><span class="category-eyebrow__date">September 29, 2026</span>';
  const response=await fetchNews(apple,{},async url=>new Response(String(url).endsWith('.rss')?xml:html));
  assert.equal(response.status,'modified');if(response.status==='modified'){assert.equal(response.page.items[0].publication_date,'2026-09-29');assert.equal(response.page.items[0].published_at,null);}
  assert.equal(articlePublicationDay(html.replace('September 29, 2026','February 30, 2026'),'apple-newsroom'),null);
});
test('publisher concurrency is bounded, failures are isolated and result order is stable',async()=>{
  const sources=NEWS_SOURCES.slice(0,5),{db}=memoryDb();let running=0,max=0;
  const results=await collectNewsSources(sources,firestoreNewsStore(db),async source=>{
    running++;max=Math.max(max,running);await new Promise(resolve=>setTimeout(resolve,10));running--;
    if(source.id===sources[1].id)throw new Error('publisher unavailable');
    return {status:'modified',page:{items:[],invalid:0,truncated:false},validators:{}};
  },()=>at);
  assert.equal(max,2);assert.deepEqual(results.map(result=>result.sourceId),sources.map(source=>source.id));
  assert.equal(results[1].status,'failed');assert.equal(results.filter(result=>result.status==='ok').length,4);
});


test('unresolved article dates fail without advancing the checkpoint and are retried',async()=>{
  const apple=NEWS_SOURCES.find(source=>source.id==='apple-news')!,{db,records}=memoryDb(),store=firestoreNewsStore(db);
  const xml='<feed><entry><title>Update</title><link href="https://www.apple.com/newsroom/article"/><updated>2026-10-02T15:00:00Z</updated></entry></feed>';
  let resolved=false,articleReads=0;
  const request:typeof fetch=async url=>{if(String(url).endsWith('.rss'))return new Response(xml,{headers:{etag:'new-version'}});articleReads++;return new Response(resolved?'<span class="category-eyebrow__date">October 2, 2026</span>':'<html>No original date yet</html>');};
  const read:typeof fetchNews=(source,validators,_request,known)=>fetchNews(source,validators,request,known);
  const first=await collectNewsSources([apple],store,read,()=>at);assert.equal(first[0].status,'failed');
  const state=records.get(`collectors/${apple.id}`)!;assert.deepEqual(state.validators,{});assert.deepEqual(state.itemIds,[]);assert.equal(state.lastSuccessAt,null);
  assert.equal([...records.keys()].filter(key=>key.startsWith('events/')).length,0);
  resolved=true;const later=new Date(at.getTime()+apple.pollMs);
  const next=await collectNewsSources([apple],store,read,()=>later);assert.equal(next[0].status,'ok');assert.equal(next[0].created,1);assert.equal(articleReads,2);
  const event=[...records.entries()].find(([key])=>key.startsWith('events/'))![1];assert.equal(event.publication_date,'2026-10-02');assert.equal(event.published_at,null);
});
