import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSecDocumentCache,SEC_CACHE_RETENTION_MS,secArchiveIdentity,secCacheOwner,withSecDocumentProcessing,SEC_MAX_DOCUMENT_BYTES,type CachedSecMetadata,type SecDocumentStore} from '../../src/lib/sec-filings/document-cache';
import {secRequest} from '../../src/lib/sec-request';
import {prepareSecFiling,secFilingDocumentUrl,prepareSecIntake,parseSecIntakeJob,SEC_DOWNLOAD_TOPIC} from '../../src/lib/sec-filings/download-worker';
import {createSecFilingDiscovered,SEC_FILINGS_TOPIC} from '../../src/lib/sec-filings/event';
import {earningsSourceEvent,EARNINGS_TOPIC,type EarningsJob} from '../../src/lib/earnings/live-event';
import {type EarningsSource,sourceIdentity} from '../../src/lib/earnings/model';
import type {EarningsWork} from '../../src/lib/earnings/live-store';
import {publishEarningsIntake} from '../../src/lib/sec-filings/intake-routing';
import type {Firestore} from 'firebase-admin/firestore';
import {readSecDocumentBytes,SecDocumentSizeError} from '../../src/lib/sec-filings/document-cache';
import {deliverSecIntake,SEC_DOWNLOAD_DEAD_LETTER_TOPIC} from '../../src/lib/sec-filings/download-worker';

const url='https://www.sec.gov/Archives/edgar/data/2488/000000248826000001/report.htm';
const owner=secCacheOwner('fundamentals','filing-1'),graph=secCacheOwner('graph','filing-1');
function fixture(){
  let time=Date.parse('2026-10-23T12:00:00Z'),generation=0,downloads=0;
  const objects=new Map<string,{meta:CachedSecMetadata;bytes:Buffer}>();
  const provenance=new Map<string,Map<string,CachedSecMetadata>>();
  const store:SecDocumentStore={
    metadata:async key=>objects.has(key)?structuredClone(objects.get(key)!.meta):null,
    bytes:async meta=>Buffer.from(objects.get(meta.key)!.bytes),
    create:async(meta,bytes)=>{if(objects.has(meta.key))return false;objects.set(meta.key,{meta:{...structuredClone(meta),generation:String(++generation),metageneration:'1'},bytes});return true;},
    update:async(meta,next)=>{const value=objects.get(meta.key);if(!value||value.meta.metageneration!==meta.metageneration)return false;value.meta={...structuredClone(next),metageneration:String(Number(meta.metageneration)+1)};return true;},
    async *list(prefix){for(const [key,value] of objects)if(key.startsWith(prefix))yield structuredClone(value.meta);},
    remove:async meta=>{if(objects.get(meta.key)?.meta.temporaryHold)throw new Error('Held');objects.delete(meta.key);},
    remember:async(owner,meta)=>{const files=provenance.get(owner)??new Map();files.set(meta.key,structuredClone(meta));provenance.set(owner,files);},
    processingKeys:async owner=>[...(provenance.get(owner)?.keys()??[])],
  };
  const cache=createSecDocumentCache(store,()=>time);
  return {cache,store,objects,provenance,advance:(ms:number)=>{time+=ms;},download:async()=>{downloads++;return {bytes:Buffer.from('<html>SEC original</html>'),contentType:'text/html'};},downloads:()=>downloads,cleanup:()=>cache.cleanup({deadline:time+60000,apply:true})};
}

test('strict SEC identity rejects arbitrary hosts, encoded paths, queries and traversal',()=>{
  assert.match(secArchiveIdentity(url).key,/2488\/000000248826000001\/report.htm$/);
  for(const input of [url.replace('www.sec.gov','evil.example'),url+'?download=1',url+'#x',url.replace('report.htm','..report.htm'),url.replace('https:','http:')])assert.throws(()=>secArchiveIdentity(input));
});

test('download once, verify original bytes, reuse across independent consumers',async()=>{
  const f=fixture();await f.cache.read(url,[owner,graph],f.download);
  const response=await f.cache.read(url,[graph],f.download);
  assert.equal(f.downloads(),1);assert.equal(response.bytes.toString(),'<html>SEC original</html>');
  const object=f.objects.get(secArchiveIdentity(url).key)!;
  assert.equal(object.meta.sourceUrl,url);assert.match(object.meta.rawSha256,/^[a-f0-9]{64}$/);assert.equal(object.meta.temporaryHold,true);
  object.bytes=Buffer.from('corrupted');await assert.rejects(f.cache.read(url,[graph],f.download),/integrity/);
});

test('pending or failed processing protects originals beyond ninety days',async()=>{
  const f=fixture();await f.cache.read(url,[owner,graph],f.download);
  await f.cache.complete(owner,secArchiveIdentity(url).prefix);
  f.advance(SEC_CACHE_RETENTION_MS*2);assert.equal((await f.cleanup()).deleted,0);
  assert.equal((await f.cleanup()).protected,1);assert.equal(f.objects.size,1);
});

test('all consumers must finish, then retain ninety days after completion',async()=>{
  const f=fixture();await f.cache.read(url,[owner,graph],f.download);
  f.advance(86400000);await f.cache.complete(owner,secArchiveIdentity(url).prefix);
  await f.cache.complete(graph,secArchiveIdentity(url).prefix);
  f.advance(SEC_CACHE_RETENTION_MS-1);assert.equal((await f.cleanup()).deleted,0);
  f.advance(1);assert.equal((await f.cleanup()).deleted,1);assert.equal(f.objects.size,0);
  assert.equal(f.provenance.get(owner)?.get(secArchiveIdentity(url).key)?.sourceUrl,url,'source provenance survives deleting original bytes');
});

test('completion finds other accession files touched before an interrupted attempt',async()=>{
  const f=fixture(),other=url.replaceAll('000000248826000001','000000248826000002');
  await f.cache.read(url,[owner],f.download);await f.cache.read(other,[owner],f.download);
  await f.cache.complete(owner,secArchiveIdentity(url).prefix);
  assert([...f.objects.values()].every(object=>!object.meta.temporaryHold));
});

test('later consumers restore the hold and reset the completion retention clock',async()=>{
  const f=fixture();await f.cache.read(url,[owner],f.download);await f.cache.complete(owner,secArchiveIdentity(url).prefix);
  f.advance(SEC_CACHE_RETENTION_MS);await f.cache.read(url,[graph],f.download);
  assert.equal((await f.cleanup()).deleted,0);await f.cache.complete(graph,secArchiveIdentity(url).prefix);
  assert.equal((await f.cleanup()).deleted,0);f.advance(SEC_CACHE_RETENTION_MS);assert.equal((await f.cleanup()).deleted,1);
});

test('failed/oversized downloads do not fan out or create successful cache entries',async()=>{
  const f=fixture();await assert.rejects(f.cache.read(url,[owner],async()=>{throw new Error('429');}),/429/);
  assert.equal(f.objects.size,0);
  await assert.rejects(f.cache.read(url,[owner],async()=>({bytes:Buffer.alloc(SEC_MAX_DOCUMENT_BYTES+1),contentType:'text/html'})),/bounds/);
  assert.equal(f.objects.size,0);
});

test('existing SEC transport decodes cached originals and clears only the successful processor',async()=>{
  const f=fixture();await f.cache.read(url,[owner,graph],f.download);
  const result=await withSecDocumentProcessing(owner,url,()=>secRequest(url,{},response=>response.text()),()=>true,f.cache);
  assert.equal(result,'<html>SEC original</html>');assert.equal(f.downloads(),1);
  const meta=f.objects.get(secArchiveIdentity(url).key)!.meta;
  assert.equal(meta.owners[owner],'complete');assert.equal(meta.owners[graph],'pending');assert.equal(meta.temporaryHold,true);
});

test('errors or deferred processing never clear retention holds',async()=>{
  const f=fixture();await f.cache.read(url,[owner],f.download);
  await assert.rejects(withSecDocumentProcessing(owner,url,async()=>{throw new Error('Processing failed');},()=>true,f.cache),/failed/);
  await withSecDocumentProcessing(owner,url,async()=>({status:'needs_admin'}),()=>false,f.cache);
  f.advance(SEC_CACHE_RETENTION_MS*3);assert.equal((await f.cleanup()).deleted,0);
});

const event=createSecFilingDiscovered({companyId:'AMD',cik:'0000002488',accessionNumber:'0000002488-26-000001',form:'10-K',filingDate:'2026-10-22',primaryDocument:'report.htm',isXbrl:true,discoveredAt:'2026-10-23T12:00:00Z'});
test('oversized originals are retained for review and never acknowledged on quarantine failure',async()=>{
  const f=fixture(),sent:unknown[]=[];
  const options={enabled:true,cache:f.cache,download:async()=>{throw new SecDocumentSizeError();},publish:async(topic:string,message:unknown)=>{assert.equal(topic,SEC_DOWNLOAD_DEAD_LETTER_TOPIC);sent.push(message);}};
  assert.equal((await deliverSecIntake(event,{} as Firestore,options)).status,'needs_admin');
  assert.deepEqual(sent,[event]);assert.equal(f.objects.size,0);
  await assert.rejects(deliverSecIntake(event,{} as Firestore,{...options,publish:async()=>{throw Error('Audit publish unavailable');}}),/Audit publish/);
  await assert.rejects(deliverSecIntake(event,{} as Firestore,{...options,download:async()=>{throw Object.assign(Error('cooldown'),{code:429});}}),{code:429});
  assert.equal(sent.length,1,'transient failures must remain on the original queue');
});

test('byte limits cancel streams and distinguish oversized originals from empty responses',async()=>{
  let cancelled=0;
  const large=()=>new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(SEC_MAX_DOCUMENT_BYTES+1));},cancel(){cancelled++;}});
  await assert.rejects(readSecDocumentBytes(new Response(large(),{headers:{'content-length':String(SEC_MAX_DOCUMENT_BYTES+1)}})),SecDocumentSizeError);
  await assert.rejects(readSecDocumentBytes(new Response(large())),SecDocumentSizeError);
  assert.equal(cancelled,2);
  await assert.rejects(readSecDocumentBytes(new Response(null)),error=>error instanceof Error&&!(error instanceof SecDocumentSizeError));
});
test('queued download durably caches before publishing the unchanged SEC filing event',async()=>{
  const f=fixture(),sent:unknown[]=[];
  await prepareSecFiling(event,{enabled:true,cache:f.cache,download:f.download,publish:async(topic,message)=>{assert.equal(topic,SEC_FILINGS_TOPIC);assert.equal(f.objects.size,1);sent.push(message);}});
  assert.deepEqual(sent,[event]);assert.equal(secFilingDocumentUrl(event),url);
  await prepareSecFiling(event,{enabled:true,cache:f.cache,download:f.download,publish:async()=>{}});
  assert.equal(f.downloads(),1);
});

test('publish failures keep originals pinned for replay without another SEC download',async()=>{
  const f=fixture();await assert.rejects(prepareSecFiling(event,{enabled:true,cache:f.cache,download:f.download,publish:async()=>{throw new Error('Publish uncertain');}}),/uncertain/);
  f.advance(SEC_CACHE_RETENTION_MS*2);assert.equal((await f.cleanup()).deleted,0);
  await prepareSecFiling(event,{enabled:true,cache:f.cache,download:f.download,publish:async()=>{}});assert.equal(f.downloads(),1);
});

const earningsSource:EarningsSource={provider:'sec',companyId:'US:AMD',issuerId:'sec:0000002488',documentId:'0000002488-26-000001/report.htm',url,title:'AMD 8-K',accession:'0000002488-26-000001',form:'8-K',filingDate:'2026-10-22',firstSeenAt:'2026-10-23T12:00:00Z',publishedAt:null,language:'en'};
function earningsWork(source=earningsSource,inputKind:'sec_filing'|'document'='sec_filing'):EarningsWork{
  return {recordType:'source',source,sourceId:sourceIdentity(source),inputKind,generation:1,status:'queued',publishPending:true,attempts:0,firstSeenAt:source.firstSeenAt,lastObservedAt:source.firstSeenAt,nextCheckAtMs:0};
}
const db={collection:(name:string)=>({doc:(id:string)=>({path:`${name}/${id}`})}),
  getAll:async(...args:Array<{path:string}|{fieldMask:string[]}>)=>args.filter((ref):ref is {path:string}=>'path' in ref).map(ref=>({data:()=>ref.path==='companies/US:AMD'
    ? {name:'AMD',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}}
    : ref.path==='collectors/sec-identity-US:AMD'?{companyId:'US:AMD',cik:'0000002488'}:undefined}))} as unknown as Firestore;
test('all SEC earnings producers route through intake, while CN and probes retain the earnings queue',async()=>{
  const work=earningsWork(),request=earningsSourceEvent(work.sourceId,1),sent:Array<{topic:string;event:unknown}>=[];
  const publish=async(topic:string,event:unknown)=>{sent.push({topic,event});return 'message-id';};
  await publishEarningsIntake(db,request,{enabled:true,readWork:async()=>work,publish});
  assert.equal(sent[0].topic,SEC_DOWNLOAD_TOPIC);assert.deepEqual(sent[0].event,request);
  await publishEarningsIntake(db,request,{enabled:true,readWork:async()=>({...work,source:{...work.source,provider:'cninfo'}}),publish});
  assert.equal(sent[1].topic,EARNINGS_TOPIC);
  await publishEarningsIntake(db,request,{enabled:false,publish});assert.equal(sent[2].topic,EARNINGS_TOPIC);
  const probe:EarningsJob={version:1,type:'earnings.delivery.probe',batchId:'earnings_probe_'+'a'.repeat(32),createdAt:'2026-10-23T12:00:00Z'};
  await publishEarningsIntake(db,probe,{enabled:true,publish});assert.equal(sent[3].topic,EARNINGS_TOPIC);
  await assert.rejects(publishEarningsIntake(db,request,{enabled:true,readWork:async()=>undefined,publish}),/durable/);
});
test('8-K intake caches the official index before a separate earnings processing task',async()=>{
  const f=fixture(),work=earningsWork(),request=earningsSourceEvent(work.sourceId,1),downloaded:string[]=[],sent:unknown[]=[];
  await prepareSecIntake(request,db,{enabled:true,cache:f.cache,readWork:async()=>work,download:async input=>{downloaded.push(input);return f.download();},publish:async(topic,task)=>{assert.equal(topic,EARNINGS_TOPIC);assert.equal(f.objects.size,1);sent.push(task);}});
  assert.equal(downloaded[0],url.replace('report.htm','0000002488-26-000001-index.html'));
  assert.deepEqual(sent,[request]);assert.equal(work.source.url,url,'SEC source links are not replaced by storage URLs');
  assert.equal(Object.values([...f.objects.values()][0].meta.owners)[0],'pending');
});
test('derived exhibits use the same intake/cache and publication failures retain their bytes',async()=>{
  const f=fixture(),work=earningsWork({...earningsSource,url:url.replace('report.htm','earnings.pdf'),documentId:'0000002488-26-000001/earnings.pdf'},'document');
  const request=earningsSourceEvent(work.sourceId,1);
  const options={enabled:true,cache:f.cache,readWork:async()=>work,download:f.download,publish:async()=>{throw new Error('Queue unavailable');}};
  await assert.rejects(prepareSecIntake(request,db,options),/unavailable/);
  await prepareSecIntake(request,db,{...options,publish:async topic=>{assert.equal(topic,EARNINGS_TOPIC);}});
  assert.equal(f.downloads(),1);assert.equal([...f.objects.values()][0].meta.sourceUrl,work.source.url);
  f.advance(SEC_CACHE_RETENTION_MS*2);assert.equal((await f.cleanup()).deleted,0);
});
test('intake validates task generations and rejects foreign issuers, probe types and unknown work',async()=>{
  const f=fixture(),work=earningsWork(),request=earningsSourceEvent(work.sourceId,1),options={enabled:true,cache:f.cache,download:f.download,publish:async()=>{}};
  assert.equal((await prepareSecIntake(request,db,{...options,readWork:async()=>({...work,generation:2})})).status,'ineligible');
  await assert.rejects(prepareSecIntake(earningsSourceEvent(work.sourceId,2),db,{...options,readWork:async()=>work}),/not durable/);
  await assert.rejects(prepareSecIntake(request,db,{...options,readWork:async()=>undefined}),/durable/);
  await assert.rejects(prepareSecIntake(request,db,{...options,readWork:async()=>({...work,source:{...work.source,url:url.replace('/2488/','/9999/')}})}),/issuer/);
  assert.throws(()=>parseSecIntakeJob({version:1,type:'earnings.delivery.probe',batchId:'earnings_probe_abc',createdAt:'2026-10-23T12:00:00Z'}));
  assert.equal(f.downloads(),0);
});

test('cached raw documents never bypass current company eligibility or SEC identity verification',async()=>{
  const f=fixture(),source={...earningsSource,companyId:'US:NEW'},work=earningsWork(source);
  const request=earningsSourceEvent(work.sourceId,1);
  let supported=true,cik='0000002488',published=0,reads=0;
  const targetedDb={collection:(name:string)=>({doc:(id:string)=>({path:`${name}/${id}`})}),
    getAll:async(...args:Array<{path:string}|{fieldMask:string[]}>)=>{
      const refs=args.filter((ref):ref is {path:string}=>'path' in ref);
      reads++;assert.deepEqual(refs.map(ref=>ref.path),['companies/US:NEW','collectors/sec-identity-US:NEW']);
      return [{data:()=>({name:'New issuer',status:'DIRECTORY',onboarding:{status:supported?'SUPPORTED':'BLOCKED'}})},
        {data:()=>({companyId:'US:NEW',cik})}];
    }} as unknown as Firestore;
  const options={enabled:true,cache:f.cache,readWork:async()=>work,download:f.download,publish:async()=>{published++;}};
  await prepareSecIntake(request,targetedDb,options);
  await prepareSecIntake(request,targetedDb,options);
  assert.equal(f.downloads(),1);assert.equal(published,2);assert.equal(reads,2);
  cik='0000001234';await assert.rejects(prepareSecIntake(request,targetedDb,options),/source identity/);
  cik='0000002488';supported=false;await assert.rejects(prepareSecIntake(request,targetedDb,options),/not supported/);
  assert.equal(f.downloads(),1);assert.equal(published,2);
});
