import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Firestore, FieldValue, Timestamp, type Query } from '@google-cloud/firestore';
import type { Bucket } from '@google-cloud/storage';
import { MarketFiles } from '../../src/lib/market-store/files';
import {EVENTS_CONTROL} from '../../src/lib/market-store/events-control';
import {RETAINED_CONTROL,retainedPath,RetainedStore} from '../../src/lib/market-store/retained-store';
import {reconcileRetainedRecords} from '../../src/lib/market-store/retained-migration';
import {FUNDAMENTALS_CONTROL} from '../../src/lib/market-store/fundamentals-control';
import { MarketRepository, CONTROL,headId } from '../../src/lib/market-store/repository';
import {bundleMarketIndexes} from '../../src/lib/market-store/index-bundles';
import { marketFirestore as routeMarketFirestore } from '../../src/lib/market-store/adapter';
import {MARKET_COLLECTIONS} from '../../src/lib/market-store/policy';
import { observeFirestore } from '../../src/lib/firebase/firestore-observability';
import { reconcileMarketShard, cleanupMarketShard } from '../../src/lib/market-store/migration';
import { shardFor } from '../../src/lib/market-store/files';
import {loadCompanyEventSnapshot} from '../../src/lib/events/company-events-cache';
import {closeLocalCaches} from '../../src/lib/local-cache/watch';
import {compactHead,pointerId,pointerCollection,pointerHasRetained} from '../../src/lib/market-store/head-pointer';
const marketFirestore:typeof routeMarketFirestore=(raw,repository)=>routeMarketFirestore(raw,repository,MARKET_COLLECTIONS);
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host))
    throw Error('Local emulator required');
const check = host ? test : test.skip;
check('web company queries and overlays reuse the incremental view after cache invalidation',async t=>{
    const prior=process.env.K_SERVICE;process.env.K_SERVICE='ifindata-web';
    const f=fixture();
    if(prior===undefined)delete process.env.K_SERVICE;else process.env.K_SERVICE=prior;
    t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true,cleanedCollections:['companies']});
    await f.raw.doc(RETAINED_CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
    await f.db.doc('companies/US:A').set({name:'External A',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}});
    await f.db.doc('companies/US:B').set({name:'External B',status:'DIRECTORY',onboarding:{status:'PENDING'}});
    await f.db.doc('companies/ORG:C').set({name:'Curated C',status:'PUBLISHED',reviewedBy:'user'});
    const all=await f.db.collection('companies').get();assert.equal(all.size,3);
    let reads=0;
    const getAll=f.raw.getAll.bind(f.raw),run=f.raw.runTransaction.bind(f.raw);
    f.raw.getAll=((...args:Parameters<typeof getAll>)=>{if(args.some(arg=>'path' in arg&&/^(companies\/|market_(state|ugc)\/companies\/)/.test(arg.path)))reads++;return getAll(...args);}) as typeof f.raw.getAll;
    f.raw.runTransaction=((...args:Parameters<typeof run>)=>{reads++;return run(...args);}) as typeof f.raw.runTransaction;
    for(let n=0;n<3;n++){
        f.repository.invalidate('companies');
        assert.equal((await f.db.collection('companies').where('status','==','DIRECTORY').get()).size,2);
        assert.equal((await f.db.collection('companies').where('status','==','PUBLISHED').select('name').get()).docs[0].get('name'),'Curated C');
        assert.equal((await f.db.collection('companies').where('onboarding.status','==','SUPPORTED').get()).docs[0].get('name'),'External A');
        assert.equal((await f.db.doc('companies/US:A').get()).get('onboarding.status'),'SUPPORTED');
        for(const operator of ['==','in'] as const){
            const page=await f.db.collection('companies').where('__name__',operator,operator==='in'?['ORG:C']:'ORG:C').select('name').get();
            assert.deepEqual(page.docs[0].data(),{name:'Curated C'},'identity queries must preserve field masks');
        }
        assert.deepEqual((await f.db.getAll(f.db.doc('companies/ORG:C'),{fieldMask:['name']}))[0].data(),{name:'Curated C'});
        assert.deepEqual((await f.db.collection('companies').where('__name__','==','ORG:C').select().get()).docs[0].data(),{});
        assert.deepEqual((await f.db.collection('companies').orderBy('name').startAt('External A').limit(1).get()).docs.map(doc=>doc.id),['US:A']);
    }
    assert.equal(reads,0,'head invalidation must not restart full scans or per-document overlay reads');
    assert.equal((await f.raw.collection('companies').get()).size,0);
});
check('staged retained reads do not switch transaction authority or events',async t=>{
    const f=fixture();t.after(()=>f.db.terminate());
    await f.raw.doc(RETAINED_CONTROL).set({version:1,ready:false,cleanupAuthorized:false});
    const ref=f.raw.doc('company_fundamentals/_worker');
    await ref.set({leaseOwner:'source'});
    await f.raw.doc(retainedPath('market_state','company_fundamentals','_worker')).set({leaseOwner:'candidate'});
    const store=new RetainedStore(f.raw,true);
    assert.equal((await store.documents([ref]))[0].get('leaseOwner'),'candidate');
    await f.raw.runTransaction(async tx=>{
        const reader={get:(ref:FirebaseFirestore.Query|FirebaseFirestore.DocumentReference)=>tx.get(ref as FirebaseFirestore.DocumentReference),getAll:(...refs:FirebaseFirestore.DocumentReference[])=>tx.getAll(...refs)};
        assert.equal((await store.documents([ref],{reader}))[0].get('leaseOwner'),'source');
    });
    const event=f.raw.doc('events/deferred');await event.set({title:'Native'});
    assert.equal((await store.documents([event]))[0].get('title'),'Native');
});
check('retained reconciliation repairs copy races and removes ghosts without changing sources',async t=>{
    const f=fixture();t.after(()=>f.db.terminate());
    await f.raw.doc(RETAINED_CONTROL).set({version:1,ready:false,cleanupAuthorized:false});
    const source=f.raw.doc('companies/US:RACE'),state=f.raw.doc(retainedPath('market_state','companies','US:RACE')),
        ugc=f.raw.doc(retainedPath('market_ugc','companies','US:RACE'));
    await source.set({onboarding:{status:'SUPPORTED'},updatedAt:Timestamp.now()});
    await state.set((await source.get()).data()!);
    // The initial copy can race with an editorial move to the UGC destination.
    await source.set({name:'Reviewed',status:'PUBLISHED',reviewedBy:'user-1',updatedAt:Timestamp.now()});
    const before=await source.get();
    await assert.rejects(reconcileRetainedRecords(f.raw,'companies',['US:RACE'],true),/parity failed/);
    assert.equal((await reconcileRetainedRecords(f.raw,'companies',['US:RACE'])).changed,2);
    assert.equal((await state.get()).exists,false);assert.deepEqual((await ugc.get()).data(),before.data());
    assert((await source.get()).updateTime!.isEqual(before.updateTime!),'reconciliation never writes the source');
    assert.equal((await reconcileRetainedRecords(f.raw,'companies',['US:RACE'],true)).changed,0);
    await source.delete();await reconcileRetainedRecords(f.raw,'companies',['US:RACE']);
    assert.equal((await ugc.get()).exists,false,'a destination created after source deletion must not survive');
    await f.raw.doc(RETAINED_CONTROL).update({ready:true});
    await assert.rejects(reconcileRetainedRecords(f.raw,'companies',['US:RACE']),/mirror phase/);
    await assert.rejects(reconcileRetainedRecords(f.raw,'events',['excluded']),/Invalid retained migration batch/);
});
check('retained records move atomically, preserve queries and never recreate retired collections',async t=>{
    const f=fixture(false,false,false,false,true);t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true,cleanedCollections:['companies','company_fundamentals']});
    await f.raw.doc(EVENTS_CONTROL).set({version:1,ready:false});
    await f.raw.doc(RETAINED_CONTROL).set({version:1,ready:false,cleanupAuthorized:false});
    const a=f.db.doc('companies/US:A'),b=f.db.doc('companies/US:B'),curated=f.db.doc('companies/ORG:CURATED');
    await a.set({name:'External A',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}});
    await b.set({name:'External B',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}});
    await curated.set({name:'User company',status:'PUBLISHED',createdBy:'user-1',onboarding:{status:'SUPPORTED'}});
    const stateA=f.raw.doc(retainedPath('market_state','companies',a.id)),ugcA=f.raw.doc(retainedPath('market_ugc','companies',a.id));
    assert.deepEqual((await stateA.get()).data(),(await f.raw.doc(a.path).get()).data());
    assert.equal((await stateA.get()).get('name'),undefined);
    assert.equal((await f.raw.doc(retainedPath('market_ugc','companies',curated.id)).get()).get('name'),'User company');
    await f.raw.doc(RETAINED_CONTROL).update({ready:true});
    await new Promise(resolve=>setTimeout(resolve,1100));f.repository.invalidate();
    const page=await f.db.collection('companies').where('onboarding.status','==','SUPPORTED').orderBy('__name__').limit(2).get();
    assert.deepEqual(page.docs.map(doc=>doc.id),['ORG:CURATED','US:A']);
    assert.equal(page.docs[1].get('name'),'External A');
    assert.equal(page.docs[1].ref.path,a.path);
    const after=await f.db.collection('companies').where('onboarding.status','==','SUPPORTED').orderBy('__name__').startAfter(page.docs[1]).get();
    assert.deepEqual(after.docs.map(doc=>doc.id),['US:B']);
    await f.raw.doc(RETAINED_CONTROL).update({cleanupAuthorized:true});
    await Promise.all([a,b,curated].map(ref=>f.raw.doc(ref.path).delete()));
    await f.db.runTransaction(async tx=>{const current=await tx.get(a);assert.equal(current.get('name'),'External A');tx.update(a,{name:'Reviewed A',reviewedBy:'user-2'});});
    assert.equal((await stateA.get()).exists,false);
    assert.equal((await ugcA.get()).get('name'),'Reviewed A');
    assert.equal((await f.raw.doc(a.path).get()).exists,false);
    const relocatedPage=await f.db.collection('companies').where('onboarding.status','==','SUPPORTED').orderBy('__name__').get();
    assert.deepEqual(relocatedPage.docs.map(doc=>doc.id),['ORG:CURATED','US:A','US:B']);
    assert.equal(relocatedPage.docs.find(doc=>doc.id==='US:A')!.get('name'),'Reviewed A');
    await f.db.doc('company_fundamentals/_worker').set({leaseOwner:'test-owner',leaseUntil:123});
    assert.equal((await f.raw.doc('company_fundamentals/_worker').get()).exists,false);
    assert.equal((await f.raw.doc(retainedPath('market_state','company_fundamentals','_worker')).get()).get('leaseOwner'),'test-owner');
    await a.delete();assert.equal((await ugcA.get()).get('isDeleted'),true,'normal authored deletions retain the existing soft-delete behavior');
    await marketFirestore(f.raw,f.repository).doc(a.path).delete();assert.equal((await ugcA.get()).exists,false);
    await f.db.doc('events/native-feed').set({title:'Keep the feed in Firestore'});
    assert.equal((await f.raw.doc('events/native-feed').get()).get('title'),'Keep the feed in Firestore');
    assert.equal((await f.raw.doc(retainedPath('market_state','events','native-feed')).get()).exists,false);
});
check('native announcement snapshots remain listenable before Parquet cutover',async t=>{
    const raw=new Firestore({projectId:'demo-announcements-'+randomUUID().slice(0,8)});
    t.after(async()=>{closeLocalCaches();await raw.terminate();});
    await raw.doc('events/one').set({companyId:'US:AMD',publication_date:'2026-11-13',title:'Original'});
    assert.equal((await loadCompanyEventSnapshot(raw,'US:AMD',12)).docs[0].get('title'),'Original');
    await raw.doc('events/one').update({title:'Updated'});
    let title:unknown;
    for(let n=0;n<50;n++){title=(await loadCompanyEventSnapshot(raw,'US:AMD',12)).docs[0].get('title');if(title==='Updated')break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(title,'Updated');
});
function fixture(stagedReads=false,compact:boolean|'default'=false,fundamentalsGate=false,stagedFundamentals=false,eventsGate=false,stagedEvents=false) {
    const objects = new Map<string, Buffer>();
    let fail = false;
    const bucket = { file: (name: string) => ({ download: async (options?: {
                destination: string;
            }) => { const bytes = objects.get(name); if (!bytes)
                throw Error('Missing object'); if (options)
                await writeFile(options.destination, bytes); return [bytes]; } }), upload: async (path: string, options: {
            destination: string;
        }) => { if (fail)
            throw Error('Injected upload failure'); assert(!objects.has(options.destination)); objects.set(options.destination, await readFile(path)); } } as unknown as Bucket;
    const previous=process.env.MARKET_PARQUET_HEAD_POINTERS;
    if(compact==='default')delete process.env.MARKET_PARQUET_HEAD_POINTERS;
    else process.env.MARKET_PARQUET_HEAD_POINTERS=compact?'1':'0';
    const raw = new Firestore({ projectId: 'demo-market-' + randomUUID().slice(0, 8) }), repository = new MarketRepository(raw, new MarketFiles(bucket,32*1024*1024),undefined,false,stagedReads,fundamentalsGate,stagedFundamentals,eventsGate,stagedEvents);
    if(previous===undefined)delete process.env.MARKET_PARQUET_HEAD_POINTERS;else process.env.MARKET_PARQUET_HEAD_POINTERS=previous;
    return { raw, repository, db: observeFirestore(marketFirestore(raw, repository), () => { }), fail: () => { fail = true; }, objects };
}
for(const suffix of ['-ca.parquet','-af.parquet'])check(`${suffix} upload failure cannot publish a new event or shard pointer`,async t=>{
    const f=fixture(true,false,false,false,true,true);t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:false});await f.raw.doc(EVENTS_CONTROL).set({version:1,ready:false});
    const event=f.db.doc('events/calendar-atomic');await event.set({type:'scheduled_event',scheduled_date:'2026-11-17',title:'Original'});
    const ref=f.raw.doc('collectors/'+headId('events',shardFor(event.id))),before=(await ref.get()).data(),source=(await f.raw.doc(event.path).get()).data();
    const bucket=f.repository.files.bucket as unknown as {upload(path:string,options:{destination:string}):Promise<unknown>},upload=bucket.upload.bind(bucket);
    bucket.upload=async(path,options)=>{if(options.destination.endsWith(suffix))throw Error('Calendar sidecar unavailable');return upload(path,options);};
    await assert.rejects(event.update({title:'Unpublished',scheduled_date:'2026-12-01'}),/Calendar sidecar unavailable/);
    assert.deepEqual((await ref.get()).data(),before);assert.deepEqual((await f.raw.doc(event.path).get()).data(),source);
    assert.equal((await event.get()).get('title'),'Original');
});
check('production routing keeps events and fundamentals native after cutover and cleanup authorization',async t=>{
    const f=fixture(true,false,true,false,true);t.after(()=>f.db.terminate());
    await f.raw.doc(EVENTS_CONTROL).set({version:1,ready:false});
    await f.raw.doc(FUNDAMENTALS_CONTROL).set({version:1,ready:false});
    const db=routeMarketFirestore(f.raw,f.repository);
    await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
    const event=db.doc('events/native'),fund=db.doc('company_fundamentals/US:NVDA'),ticker=db.doc('tickers/NVDA');
    await db.batch().set(event,{companyId:'US:NVDA',title:'Native event'}).set(fund,{marketCap:123}).set(ticker,{symbol:'NVDA',name:'Parquet ticker'}).commit();
    assert.equal((await f.raw.doc(event.path).get()).get('title'),'Native event');
    assert.equal((await f.raw.doc(fund.path).get()).get('marketCap'),123);
    assert.equal((await f.raw.doc(ticker.path).get()).exists,false);
    assert.deepEqual((await db.getAll(event,fund,ticker)).map(doc=>doc.data()),[{companyId:'US:NVDA',title:'Native event'},{marketCap:123},{symbol:'NVDA',name:'Parquet ticker'}]);
    await db.runTransaction(async tx=>{await tx.getAll(event,fund,ticker);tx.update(event,{title:'Updated native'});tx.update(fund,{marketCap:456});tx.update(ticker,{name:'Updated Parquet'});});
    assert.equal((await f.raw.doc(event.path).get()).get('title'),'Updated native');
    assert.equal((await f.raw.doc(fund.path).get()).get('marketCap'),456);
    assert.equal((await ticker.get()).get('name'),'Updated Parquet');
    assert.equal((await db.collection('events').where('companyId','==','US:NVDA').get()).size,1);
    let stop=()=>{};
    try{
        const live=await new Promise<string>((resolve,reject)=>{stop=db.collection('events').where('companyId','==','US:NVDA').onSnapshot(s=>resolve(s.docs[0].get('title')),reject);});
        assert.equal(live,'Updated native','native query listeners remain available after global cutover');
    }finally{stop();}
    assert.equal((await f.raw.collection('collectors').where('marketCollection','==','events').get()).size,1,'events are mirrored while native reads remain authoritative');
});
check('website deployments default to the complete compact pointer inventory',async t=>{
    const service=process.env.K_SERVICE;process.env.K_SERVICE='ifindata-web';
    const f=fixture(true,'default');
    if(service===undefined)delete process.env.K_SERVICE;else process.env.K_SERVICE=service;
    t.after(()=>f.db.terminate());
    const batch=f.raw.batch();
    for(let i=0;i<256;i++){
        const shard=i.toString(16).padStart(2,'0');
        batch.set(f.raw.collection('collectors').doc(pointerId('events',shard)),{marketCollection:pointerCollection('events'),marketHead:compactHead({collection:'events',shard,rows:0,retained:[]})});
    }
    await batch.commit();assert.equal((await f.repository.heads('events')).size,256);
});
check('index publication retries concurrent writers, updates both heads, and resumes daily after cutover',async t=>{
    const f=fixture(true,true);t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:false});
    await f.raw.doc(EVENTS_CONTROL).set({version:1,ready:false});
    for(const pointer of [false,true]){
        const batch=f.raw.batch();
        for(let i=0;i<256;i++){
            const shard=i.toString(16).padStart(2,'0'),head={collection:'events' as const,shard,rows:0,retained:[]};
            batch.set(f.raw.collection('collectors').doc((pointer?pointerId:headId)('events',shard)),{marketCollection:pointer?pointerCollection('events'):'events',marketHead:pointer?compactHead(head):head});
        }
        await batch.commit();
    }
    const ids:string[]=[];for(let i=0;ids.length<2;i++){const id='bundle-race-'+i,shard=shardFor(id);if(shard.startsWith('0')&&!ids.some(id=>shardFor(id)===shard))ids.push(id);}
    for(const id of ids)await f.db.doc('events/'+id).set({companyId:'US:NVDA',title:'Original',publication_date:'2026-11-13'});
    const bundle=f.repository.files.bundleIndexes.bind(f.repository.files);let calls=0;
    f.repository.files.bundleIndexes=async heads=>{
        const result=await bundle(heads);
        if(calls++===0)await f.db.doc('events/'+ids[0]).update({title:'Concurrent writer'});
        return result;
    };
    const options={ready:false,collections:['events'] as const,before:async()=>{}};
    const result=await bundleMarketIndexes(f.raw,f.repository.files,options);
    assert.equal(calls,2,'changed heads must discard the obsolete bundle and rebuild');
    assert.equal(result[0].changed,2);
    const heads=await f.raw.getAll(...ids.map(id=>f.raw.collection('collectors').doc(headId('events',shardFor(id)))));
    assert.equal(heads[0].get('marketHead.indexFile'),heads[1].get('marketHead.indexFile'));
    for(const doc of heads){const head=doc.get('marketHead');assert.equal(head.format,112);assert.deepEqual((await f.raw.collection('collectors').doc(pointerId('events',head.shard)).get()).get('marketHead'),compactHead(head));}
    const query=f.db.collection('events').where('companyId','==','US:NVDA').orderBy('publication_date','desc').limit(5).select('title');
    assert.equal((await query.get()).docs.find(doc=>doc.id===ids[0])?.get('title'),'Concurrent writer');
    assert.equal((await bundleMarketIndexes(f.raw,f.repository.files,options))[0].changed,0,'unchanged bundles are not rebuilt');
    await f.raw.doc(CONTROL).update({ready:true,cleanupAuthorized:true});
    await f.raw.doc(EVENTS_CONTROL).update({ready:true,cleanupAuthorized:true});
    await f.db.doc('events/'+ids[1]).update({title:'After cleanup'});
    assert.equal((await f.raw.doc('events/'+ids[1]).get()).exists,false);
    await assert.rejects(bundleMarketIndexes(f.raw,f.repository.files,options));
    await assert.rejects(bundleMarketIndexes(f.raw,f.repository.files,{...options,ready:true,prepared:async()=>{throw Error('audit unavailable');}}),/audit unavailable/);
    assert.equal((await f.raw.collection('collectors').doc(headId('events',shardFor(ids[1]))).get()).get('marketHead.format'),12,'failed audit must not publish new heads');
    const daily=await bundleMarketIndexes(f.raw,f.repository.files,{...options,ready:true});
    assert.equal(daily[0].changed,2);
    assert.equal((await query.get()).docs.find(doc=>doc.id===ids[1])?.get('title'),'After cleanup');
    await assert.rejects(bundleMarketIndexes(f.raw,f.repository.files,{...options,ready:true,before:async()=>{throw Error('capacity');}}),/capacity/);
});
check('compact live heads preserve external data, operational changes and transactional originals',async t=>{
    const f=fixture(false,true);t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
    const batch=f.raw.batch();
    for(let i=0;i<256;i++){
        const shard=i.toString(16).padStart(2,'0');
        batch.set(f.raw.collection('collectors').doc(pointerId('events',shard)),{marketCollection:pointerCollection('events'),marketHead:compactHead({collection:'events',shard,rows:0,retained:[]})});
    }
    await batch.commit();
    const ref=f.db.doc('events/compact'),shard=shardFor('compact');
    await ref.set({companyId:'US:NVDA',title:'External',newsAnalysisPending:true});
    const pointer=await f.raw.collection('collectors').doc(pointerId('events',shard)).get();
    assert.equal(pointerHasRetained(pointer.get('marketHead')),true);
    assert.equal((await ref.get()).get('newsAnalysisPending'),true);
    await f.db.runTransaction(async tx=>{const doc=await tx.get(ref);assert.equal(doc.get('title'),'External');tx.update(ref,{newsAnalysisPending:false});});
    assert.equal((await ref.get()).get('newsAnalysisPending'),false);
    // A different writer must invalidate cached readers through the live pointer.
    const writer=new MarketRepository(f.raw,new MarketFiles(f.repository.files.bucket,0));
    const other=marketFirestore(f.raw,writer);t.after(()=>writer.close());
    await other.doc(ref.path).update({title:'Changed remotely'});
    let title:unknown;
    for(let i=0;i<100;i++){title=(await ref.get()).get('title');if(title==='Changed remotely')break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(title,'Changed remotely');
    await ref.delete();assert.equal((await ref.get()).exists,false);
});
check('compact reads reject incomplete inventories instead of returning partial market data',async t=>{
    const f=fixture(false,true);t.after(()=>f.db.terminate());
    await assert.rejects(f.repository.heads('events'),/Incomplete compact market head inventory/);
});
check('conservative pointers never replace Parquet with an external-only source mirror',async t=>{
    const f=fixture(false,true);t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:true});
    const batch=f.raw.batch();
    for(let i=0;i<256;i++){
        const shard=i.toString(16).padStart(2,'0');
        batch.set(f.raw.collection('collectors').doc(pointerId('events',shard)),{marketCollection:pointerCollection('events'),marketHead:compactHead({collection:'events',shard,rows:0,retained:[]})});
    }
    await batch.commit();
    const live='operational',shard=shardFor(live);let external='';
    for(let i=0;!external;i++)if(shardFor('external-'+i)===shard)external='external-'+i;
    await f.db.doc('events/'+live).set({companyId:'US:AMD',title:'Live event',newsAnalysisPending:true});
    const ref=f.db.doc('events/'+external);await ref.set({companyId:'US:AMD',title:'Parquet value'});
    await f.raw.doc(ref.path).update({title:'Divergent mirror'});
    const expected={companyId:'US:AMD',title:'Parquet value'};
    assert.deepEqual((await ref.get()).data(),expected);
    const query=f.db.collection('events').where('companyId','==','US:AMD');
    assert.deepEqual((await query.get()).docs.find(doc=>doc.id===external)?.data(),expected);
    assert.deepEqual((await ref.get()).updateTime,(await f.repository.files.read(await f.repository.head('events',shard))).find(row=>row.id===external)?.version);
    // This is the normal post-cleanup state for an external-only record.
    await f.raw.doc(ref.path).delete();f.repository.invalidate('events');
    assert.deepEqual((await ref.get()).data(),expected);
    assert.deepEqual((await query.get()).docs.find(doc=>doc.id===external)?.data(),expected);
});
check('cached external queries merge fresh operational state and replace changed external data',async t=>{
    const f=fixture();t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
    const ref=f.db.doc('events/cached'),query=f.db.collection('events').where('companyId','==','US:NVDA');
    await ref.set({companyId:'US:NVDA',title:'Before',newsAnalysisPending:true});
    assert.equal((await query.get()).docs[0].get('newsAnalysisPending'),true);
    const head=()=>f.repository.head('events',shardFor('cached'));
    const first=await head();
    await ref.update({newsAnalysisPending:false});
    assert.equal((await head()).file,first.file,'operational update retains immutable external file');
    const updated=(await query.get()).docs[0];assert.equal(updated.get('title'),'Before');assert.equal(updated.get('newsAnalysisPending'),false);
    await ref.update({title:'After'});
    assert.notEqual((await head()).file,first.file);
    assert.equal((await query.get()).docs[0].get('title'),'After');
    await ref.delete();assert.equal((await query.get()).size,0);
});
check('staged website reads use Parquet while transactions preserve source mirrors and UGC',async t=>{
    const f=fixture(true);t.after(()=>f.db.terminate());
    await assert.rejects(f.db.doc('company_directory/NVDA').get(),/control is missing/);
    await f.raw.doc(CONTROL).set({version:1,ready:false});
    const ref=f.db.doc('company_directory/NVDA');await ref.set({name:'NVIDIA',score:1});
    assert.equal((await f.raw.doc('company_directory/NVDA').get()).get('score'),1);
    // Diverge the native copy deliberately in the isolated emulator to prove
    // ordinary reads and transactional reads follow their separate gates.
    await f.raw.doc('company_directory/NVDA').update({score:2});
    assert.equal((await ref.get()).get('score'),1);
    await f.db.runTransaction(async tx=>{const current=await tx.get(ref);assert.equal(current.get('score'),2);tx.update(ref,{score:3});tx.set(f.db.doc('users/user'),{note:'User content'});});
    assert.equal((await ref.get()).get('score'),3);
    assert.equal((await f.raw.doc('company_directory/NVDA').get()).get('score'),3);
    assert.equal((await f.raw.doc('users/user').get()).get('note'),'User content');
    await f.raw.doc(CONTROL).update({ready:true});
    await ref.update({score:4});assert.equal((await f.raw.doc('company_directory/NVDA').get()).get('score'),4,'read cutover alone must not retire the source');
    await f.raw.doc(CONTROL).update({cleanupAuthorized:true});
    await ref.update({score:5});assert.equal((await f.raw.doc('company_directory/NVDA').get()).exists,false);assert.equal((await ref.get()).get('score'),5);
});
check('staged snapshot preconditions accept unchanged mirrors and reject stale or divergent sources',async t=>{
    const f=fixture(true);t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:false});
    const ref=f.db.doc('company_directory/NVDA'),native=f.raw.doc('company_directory/NVDA');
    await ref.set({score:1});const first=await ref.get();
    assert(!first.updateTime!.isEqual((await native.get()).updateTime!),'Parquet preparation precedes the native commit');
    await ref.update({score:2},{lastUpdateTime:first.updateTime!});
    assert.equal((await native.get()).get('score'),2);
    await assert.rejects(ref.update({score:3},{lastUpdateTime:first.updateTime!}),/precondition/);
    const current=await ref.get();await native.update({score:99});
    await assert.rejects(ref.update({score:3},{lastUpdateTime:current.updateTime!}),/precondition/);
    assert.equal((await native.get()).get('score'),99);
});
for(const compact of [false,true])check(`full document reads skip retained records without hiding external data (compact=${compact})`,async t=>{
    const f=fixture(true,compact);t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:false});
    if(compact){
        const batch=f.raw.batch();
        for(let i=0;i<256;i++){
            const shard=i.toString(16).padStart(2,'0');
            batch.set(f.raw.collection('collectors').doc(pointerId('companies',shard)),{marketCollection:pointerCollection('companies'),marketHead:compactHead({collection:'companies',shard,rows:0,retained:[]})});
        }
        await batch.commit();
    }
    const authored=f.db.doc('companies/authored'),external=f.db.doc('companies/external');
    await authored.set({name:'Editorial',status:'PUBLISHED',createdBy:'user',onboarding:{status:'complete'}});
    await external.set({name:'External',status:'DIRECTORY',onboarding:{status:'complete'}});
    await f.raw.doc(external.path).update({name:'Stale source mirror'});
    const query=f.repository.files.query.bind(f.repository.files);
    const scanned:string[][]=[];
    f.repository.files.query=async(heads,steps,indexed)=>{
        const ids=steps.find(step=>step.method==='where'&&step.args[1]==='in')?.args[2] as string[];
        if(ids)scanned.push(ids);
        return query(heads,steps,indexed);
    };
    const docs=await f.db.getAll(authored,external,f.db.doc('companies/missing'));
    assert.deepEqual(docs.map(doc=>doc.get('name')),['Editorial','External',undefined]);
    assert.deepEqual(docs[0].get('onboarding'),{status:'complete'});
    assert(scanned.length>0);assert(scanned.every(ids=>!ids.includes('authored')));
    assert(scanned.some(ids=>ids.includes('external')),'external mirrors cannot replace Parquet');
    await authored.update({name:'Revised editorial'});
    assert.equal((await authored.get()).get('name'),'Revised editorial');
    // Cleanup strips the external status/name from a mixed native document.
    // An absent status is not evidence that the overlay is a whole company.
    await f.raw.doc(CONTROL).update({ready:true,cleanupAuthorized:true});
    await marketFirestore(f.raw,f.repository).doc(external.path).update({onboarding:{status:'pending'}});
    const stripped=await f.raw.doc(external.path).get();
    assert.equal(stripped.get('name'),undefined);assert.equal(stripped.get('status'),undefined);
    assert.deepEqual(stripped.get('onboarding'),{status:'pending'});
    assert.equal((await external.get()).get('name'),'External');
    assert.equal((await external.get()).get('status'),'DIRECTORY');
    assert.deepEqual((await external.get()).get('onboarding'),{status:'pending'});
    assert.equal((await authored.get()).get('name'),'Revised editorial');
    await authored.delete();assert.equal((await authored.get()).get('isDeleted'),true,'entity deletion preserves its tombstone');
    const direct=marketFirestore(f.raw,f.repository).doc(authored.path);
    await direct.delete();assert.equal((await authored.get()).exists,false);
    await direct.set({name:'Now external',status:'DIRECTORY'});
    assert.equal((await authored.get()).get('name'),'Now external');
    assert(scanned.some(ids=>ids.includes('authored')),'reclassification must resume external reads');
});
check('full directory scans do not reread absent external payloads for retained companies',async t=>{
    const f=fixture(true);t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:false});
    await f.db.doc('companies/external').set({name:'External',status:'DIRECTORY',onboarding:{status:'complete'}});
    await f.db.doc('companies/authored').set({name:'Authored',status:'PUBLISHED',createdBy:'user'});
    const query=f.repository.files.query.bind(f.repository.files);
    f.repository.files.query=async(heads,steps,indexed)=>{
        assert(!steps.some(step=>step.method==='where'&&String(step.args[0])==='__name__'&&Array.isArray(step.args[2])&&step.args[2].includes('authored')),'complete scan must not reload absent authored IDs');
        return query(heads,steps,indexed);
    };
    for(const ordered of [false,true]){
        const base=f.db.collection('companies').select('name','status');
        const snapshot=await (ordered?base.orderBy('__name__'):base).get();
        const expected=await f.raw.collection('companies').select('name','status').orderBy('__name__').get();
        assert.deepEqual(snapshot.docs.map(doc=>doc.data()),expected.docs.map(doc=>doc.data()));
    }
    f.repository.files.query=query;
    assert.equal((await f.db.collection('companies').where('name','==','Authored').limit(1).get()).docs[0].get('createdBy'),'user');
});
check('external event projections avoid overlay document reads but live-state projections still merge',async t=>{
    const f=fixture();t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
    await f.db.doc('events/news').set({companyId:'US:NVDA',title:'Headline',publication_date:'2026-11-13',feedCacheChangedAt:new Timestamp(1700000000,0)});
    const getAll=f.raw.getAll.bind(f.raw);let reads=0;
    f.raw.getAll=((...args:Parameters<typeof f.raw.getAll>)=>{if(args.some(arg=>'path' in arg&&typeof arg.path==='string'&&arg.path.startsWith('events/')))reads++;return getAll(...args);}) as typeof f.raw.getAll;
    const base=f.db.collection('events').where('companyId','==','US:NVDA').orderBy('publication_date','desc');
    assert.deepEqual((await base.select('title','companyId','publication_date').get()).docs[0].data(),{title:'Headline',companyId:'US:NVDA',publication_date:'2026-11-13'});
    assert.equal(reads,0,'external fields must not fetch stripped live-state documents');
    const live=await base.select('title','feedCacheChangedAt').get();
    assert.equal(live.docs[0].get('title'),'Headline');assert(live.docs[0].get('feedCacheChangedAt').isEqual(new Timestamp(1700000000,0)));assert(reads>0);
});
check('bootstrap, atomic cutover, mixed-data reads and transactional publication', async (t) => {
    const f = fixture();
    t.after(() => f.db.terminate());
    await f.raw.doc(CONTROL).set({ version: 1, ready: false });
    const filing = f.db.doc('sec_filings/filing');
    await f.db.runTransaction(async (tx) => { tx.set(filing, { form: '10-K', ticker: 'US:NVDA', discoveryPending: true, discoveryEvents: { one: { state: 'pending' } } }); tx.set(f.db.doc('collectors/queue'), { cursor: 1 }); });
    assert.equal((await f.raw.doc('sec_filings/filing').get()).get('form'), '10-K');
    await f.raw.doc(CONTROL).update({ ready: true, cleanupAuthorized: true });
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal((await filing.get()).get('form'), '10-K');
    await f.db.runTransaction(async (tx) => { const old = await tx.get(filing); assert.equal(old.get('form'), '10-K'); tx.update(filing, { discoveryPending: false }); tx.update(f.db.doc('collectors/queue'), { cursor: 2 }); });
    assert.equal((await f.raw.doc('sec_filings/filing').get()).get('form'), undefined);
    assert.equal((await filing.get()).get('form'), '10-K');
    assert.equal((await f.db.collection('sec_filings').where('discoveryPending', '==', false).where('form', '==', '10-K').get()).size, 1);
    await f.db.doc('company_directory/NVDA').set({ name: 'NVIDIA', score: 1 });
    assert.equal((await f.raw.doc('company_directory/NVDA').get()).exists, false);
    assert.equal((await f.db.doc('company_directory/NVDA').get()).get('name'), 'NVIDIA');
    f.fail();
    await assert.rejects(f.db.runTransaction(async (tx) => { tx.update(filing, { form: '10-Q' }); tx.update(f.db.doc('collectors/queue'), { cursor: 3 }); }), /upload failure/);
    assert.equal((await f.raw.doc('collectors/queue').get()).get('cursor'), 2);
    assert.equal((await filing.get()).get('form'), '10-K');
});
check('competing clients keep external increments and UGC credits in one commit', async (t) => {
    const f = fixture();
    t.after(() => f.db.terminate());
    await f.raw.doc(CONTROL).set({ version: 1, ready: true, cleanupAuthorized: true });
    await f.db.doc('company_directory/NVDA').set({ score: 0 });
    await f.db.doc('users/user').set({ credits: 0 });
    const increment = () => f.db.runTransaction(async (tx) => { const [entry, user] = await tx.getAll(f.db.doc('company_directory/NVDA'), f.db.doc('users/user')); tx.update(entry.ref, { score: Number(entry.get('score')) + 1 }); tx.update(user.ref, { credits: FieldValue.increment(1) }); });
    await Promise.all([increment(), increment(), increment()]);
    assert.equal((await f.db.doc('company_directory/NVDA').get()).get('score'), 3);
    assert.equal((await f.raw.doc('users/user').get()).get('credits'), 3);
});
check('feed marker and retained event timestamp use the same server commit', async (t) => {
    const f = fixture();
    t.after(() => f.db.terminate());
    await f.raw.doc(CONTROL).set({ version: 1, ready: true, cleanupAuthorized: true });
    await f.db.runTransaction(async (tx) => { tx.set(f.db.doc('events/news'), { type: 'company_news', title: 'External headline', companyIds: ['US:NVDA'], feedCacheChangedAt: FieldValue.serverTimestamp() }); tx.set(f.db.doc('collectors/feed'), { changedAt: FieldValue.serverTimestamp() }); });
    const event = await f.raw.doc('events/news').get(), marker = await f.raw.doc('collectors/feed').get();
    assert(event.get('feedCacheChangedAt').isEqual(marker.get('changedAt')));
    assert.equal(event.get('title'), undefined);
});
check('operational feed queries fetch only matching Parquet IDs and preserve pagination', async t => {
    const f=fixture();t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
    for(let n=0;n<5;n++)await f.db.doc('events/news-'+n).set({type:'company_news',title:'Headline '+n,feedCacheChangedAt:new Timestamp(1700000000+n,0),score:n});
    await f.db.doc('events/unrelated').set({type:'company_news',title:'Not changed',updatedAt:new Timestamp(1700000009,0)});
    const query=f.repository.files.query.bind(f.repository.files);let calls=0;
    f.repository.files.query=async(heads,steps,indexed)=>{
        assert(steps.some(step=>step.method==='where'&&String(step.args[0])==='__name__'),'operational query must use explicit IDs');
        calls++;return query(heads,steps,indexed);
    };
    const first=await f.db.collection('events').where('feedCacheChangedAt','>',new Timestamp(1700000000,0)).orderBy('feedCacheChangedAt').limit(2).get();
    assert.deepEqual(first.docs.map(doc=>doc.get('title')),['Headline 1','Headline 2']);
    const next=await f.db.collection('events').orderBy('feedCacheChangedAt').startAfter(first.docs[1]).limit(2).select('title').get();
    assert.deepEqual(next.docs.map(doc=>doc.data()),[{title:'Headline 3'},{title:'Headline 4'}]);
    const mixed=await f.db.collection('events').where('feedCacheChangedAt','>',new Timestamp(1700000000,0)).where('score','>=',3).orderBy('score','desc').limit(1).get();
    assert.equal(mixed.docs[0].get('title'),'Headline 4');assert(calls>0);
    f.repository.files.query=query;
    const external=await f.db.collection('events').where('updatedAt','>',new Timestamp(1700000008,0)).get();
    assert(external.docs.some(doc=>doc.id==='unrelated'),'external updatedAt must still be queried');
});
check('entity soft deletion and restoration survive the production lifecycle adapter', async (t) => {
    const f = fixture();
    t.after(() => f.db.terminate());
    await f.raw.doc(CONTROL).set({ version: 1, ready: true, cleanupAuthorized: true });
    const ref = f.db.doc('instruments/US:NVDA');
    await ref.set({ symbol: 'NVDA', name: 'NVIDIA' });
    await ref.delete();
    let row = await ref.get();
    assert.equal(row.get('isDeleted'), true);
    await ref.set({ name: 'Updated' }, { merge: true });
    row = await ref.get();
    assert.equal(row.get('isDeleted'), true);
    assert(row.get('deletedAt'));
    await ref.update({ isDeleted: false });
    row = await ref.get();
    assert.equal(row.get('isDeleted'), false);
    assert.equal(row.get('deletedAt'), undefined);
    assert.equal((await f.raw.doc(ref.path).get()).exists, false);
});
check('bootstrap pagination advances and retained references route through the new store after cutover', async (t) => {
    const f = fixture();
    t.after(() => f.db.terminate());
    await f.raw.doc(CONTROL).set({ version: 1, ready: false });
    for (const id of ['a', 'b', 'c'])
        await f.db.doc('company_directory/' + id).set({ name: id });
    const first = await f.db.collection('company_directory').orderBy('__name__').limit(1).get(), second = await f.db.collection('company_directory').orderBy('__name__').startAfter(first.docs[0]).limit(1).get();
    assert.equal(second.docs[0].id, 'b');
    await f.raw.doc(CONTROL).update({ ready: true, cleanupAuthorized: true });
    await new Promise(resolve => setTimeout(resolve, 1100));
    await f.raw.doc('company_directory/a').delete();
    assert.equal((await first.docs[0].ref.get()).get('name'), 'a');
    await f.db.runTransaction(async (tx) => { assert.equal((await tx.get(first.docs[0].ref)).get('name'), 'a'); });
});
check('catch-up does not write source data and cleanup preserves live state and rejects mismatches', async (t) => {
    const f = fixture();
    t.after(() => f.db.terminate());
    await f.raw.doc(CONTROL).set({ version: 1, ready: false });
    const ref = f.db.doc('sec_filings/a');
    await ref.set({ title: 'Old', discoveryPending: true, ticker: 'US:NVDA' });
    await f.raw.doc(ref.path).update({ title: 'New' });
    const before = await f.raw.doc(ref.path).get();
    await reconcileMarketShard(f.raw, f.repository.files, 'sec_filings', shardFor('a'), ['a']);
    assert((await f.raw.doc(ref.path).get()).updateTime!.isEqual(before.updateTime!));
    await f.raw.doc(CONTROL).update({ ready: true, cleanupAuthorized: true });
    await new Promise(resolve => setTimeout(resolve, 1100));
    await f.raw.doc(ref.path).update({ title: 'Uncopied' });
    await assert.rejects(cleanupMarketShard(f.raw, f.repository.files, 'sec_filings', shardFor('a'), ['a']), /parity mismatch/);
    assert.equal((await f.raw.doc(ref.path).get()).get('title'), 'Uncopied');
    await f.raw.doc(ref.path).update({ title: 'New' });
    assert.deepEqual(await cleanupMarketShard(f.raw, f.repository.files, 'sec_filings', shardFor('a'), ['a']), { deleted: 0, stripped: 1, retained: 0 });
    const source = await f.raw.doc(ref.path).get();
    assert.equal(source.get('title'), undefined);
    assert.equal(source.get('discoveryPending'), true);
    assert.equal(source.get('ticker'), 'US:NVDA');
    assert.equal((await ref.get()).get('title'), 'New');
});
check('live entity caches receive external, retained-only and removed records after cutover', async (t) => {
    const f = fixture();
    t.after(() => f.db.terminate());
    await f.raw.doc(CONTROL).set({ version: 1, ready: true, cleanupAuthorized: true });
    const seen: Array<{
        title: unknown;
        pending: unknown;
        size: number;
        removed: number;
    }> = [];
    const stop = f.db.collection('sec_filings').where('ticker', '==', 'US:NVDA').onSnapshot(snapshot => seen.push({ title: snapshot.docs[0]?.get('title'), pending: snapshot.docs[0]?.get('discoveryPending'), size: snapshot.size, removed: snapshot.docChanges().filter(c => c.type === 'removed').length }));
    t.after(stop);
    const wait = async (test: () => boolean) => { for (let n = 0; n < 100 && !test(); n++)
        await new Promise(resolve => setTimeout(resolve, 50)); assert(test(), JSON.stringify(seen)); };
    await wait(() => seen.length > 0);
    await f.db.doc('sec_filings/a').set({ title: 'New', ticker: 'US:NVDA', discoveryPending: true });
    await wait(() => seen.at(-1)?.title === 'New');
    await f.db.doc('sec_filings/a').update({ discoveryPending: false });
    await wait(() => seen.at(-1)?.pending === false);
    await f.db.doc('sec_filings/a').delete();
    await wait(() => seen.at(-1)?.size === 0 && seen.at(-1)?.removed === 1);
});
check('production query adapter agrees with native Firestore for filters, projections and cursors', async t => {
    const f = fixture(); t.after(() => f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:false});
    await f.db.runTransaction(async tx => {
        for (let score=0;score<12;score++) tx.set(f.db.doc('company_directory/item-'+String(score).padStart(2,'0')), {
            name:'Company '+score,score,tags:score%2?['odd','all']:['even','all'],nested:{flag:score%3===0},
            date:new Timestamp(1700000000+score,score),jsDate:new Date('2026-11-01'),nullable:score%2?null:'present',bytes:Buffer.from([score]),
        });
    });
    await f.raw.doc(CONTROL).update({ready:true}); await new Promise(resolve=>setTimeout(resolve,1100));
    const cases:Array<(query:Query)=>Query>=[
        q=>q.where('score','>=',4).orderBy('score','desc').limit(5),
        q=>q.orderBy('score').startAfter(7).limit(2),
        q=>q.where('tags','array-contains','even').orderBy('__name__'),
        q=>q.where('score','in',[2,5,9]),
        q=>q.where('nullable','!=','present'),
        q=>q.where('nested.flag','==',true),
        q=>q.select('name','nested.flag').orderBy('score').limitToLast(3),
        q=>q.where('date','>',new Timestamp(1700000005,5)).limit(2),
        q=>q.where('bytes','==',Buffer.from([3])),
    ];
    for(const make of cases){
        const native=await make(f.raw.collection('company_directory')).get();
        const parquet=await make(f.db.collection('company_directory')).get();
        assert.deepEqual(parquet.docs.map(d=>({id:d.id,data:d.data()})),native.docs.map(d=>({id:d.id,data:d.data()})));
    }
    const first=await f.db.collection('company_directory').orderBy('score').limit(2).get();
    const afterFirst=f.db.collection('company_directory').orderBy('score').startAfter(first.docs[0]);
    const afterSecond=f.db.collection('company_directory').orderBy('score').startAfter(first.docs[1]);
    assert.equal(afterFirst.isEqual(afterSecond),false);
    assert.equal((await afterSecond.limit(1).get()).docs[0].get('score'),2);
    const masked=await f.db.getAll(f.db.doc('company_directory/item-03'),f.db.doc('company_directory/missing'),{fieldMask:['name']});
    assert.deepEqual(masked.map(doc=>doc.data()),[{name:'Company 3'},undefined]);
    const query=f.repository.files.query.bind(f.repository.files);let queries=0;
    f.repository.files.query=async(...args)=>{if(args[2]!==false)queries++;return query(...args);};
    const grouped=await f.db.getAll(...[1,5,8].map(i=>f.db.doc('company_directory/item-'+String(i).padStart(2,'0'))),{fieldMask:['name']});
    assert.deepEqual(grouped.map(doc=>doc.get('name')),['Company 1','Company 5','Company 8']);
    assert.equal(queries,1,'bulk document reads must use one grouped Parquet query');
    const subset=await f.db.collection('company_directory').where('__name__','in',['item-08','item-01']).select('name').get();
    assert.deepEqual(subset.docs.map(doc=>doc.data()),[{name:'Company 1'},{name:'Company 8'}]);
    assert.equal(queries,1,'initial ID listeners must reuse the bulk projection');
    await f.db.doc('company_directory/item-08').update({name:'Updated'});
    assert.equal((await f.db.collection('company_directory').where('__name__','==','item-08').select('name').get()).docs[0].get('name'),'Updated');
    f.repository.files.query=query;
    assert.equal((await f.db.collection('company_directory').where('score','>=',4).count().get()).data().count,8);
    await f.db.runTransaction(async tx=>{
        const selected=await tx.get(f.db.collection('company_directory').where('score','==',3).select('score'));
        tx.update(selected.docs[0].ref,{score:30});
    });
    assert.equal((await f.db.doc('company_directory/item-03').get()).get('name'),'Company 3');
});
check('read cutover keeps a rollback mirror until UI verification authorizes source retirement', async t=>{
    const f=fixture();t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:false});
    const ref=f.db.doc('company_directory/a');await ref.set({name:'Before'});
    await f.raw.doc(CONTROL).update({ready:true});await new Promise(resolve=>setTimeout(resolve,1100));
    await ref.update({name:'During verification'});
    assert.equal((await ref.get()).get('name'),'During verification');
    assert.equal((await f.raw.doc(ref.path).get()).get('name'),'During verification');
    await assert.rejects(cleanupMarketShard(f.raw,f.repository.files,'company_directory',shardFor('a'),['a']),/verified cutover/);
    await f.raw.doc(CONTROL).update({cleanupAuthorized:true});
    await ref.update({name:'After verification'});
    assert.equal((await f.raw.doc(ref.path).get()).exists,false);
    assert.equal((await ref.get()).get('name'),'After verification');
});
check('empty external and operational documents retain their identities through cutover', async t=>{
    const f=fixture();t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:false});
    await f.db.doc('company_directory/empty').set({});
    await f.db.doc('company_directory/_live').set({});
    const partial=f.db.doc('company_directory/partial');
    await partial.set({name:'Before',value:7});
    await f.db.runTransaction(async tx=>{await tx.getAll(partial,{fieldMask:['name']});tx.update(partial,{name:'After'});});
    assert.equal((await f.raw.doc(partial.path).get()).get('value'),7,'a masked bootstrap read must not discard unselected fields');
    await f.raw.doc(CONTROL).update({ready:true,cleanupAuthorized:true});
    await new Promise(resolve=>setTimeout(resolve,1100));
    assert.equal((await f.db.doc('company_directory/empty').get()).exists,true);
    assert.equal((await f.db.doc('company_directory/_live').get()).exists,true);
    await cleanupMarketShard(f.raw,f.repository.files,'company_directory',shardFor('empty'),['empty']);
    await cleanupMarketShard(f.raw,f.repository.files,'company_directory',shardFor('_live'),['_live']);
    assert.equal((await f.raw.doc('company_directory/empty').get()).exists,false);
    assert.equal((await f.raw.doc('company_directory/_live').get()).exists,true);
    assert.equal((await f.db.doc('company_directory/empty').get()).exists,true);
});
check('mixed-record preconditions reject an external projection after live state changes',async t=>{
    const f=fixture();t.after(()=>f.db.terminate());
    await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
    const ref=f.db.doc('sec_filings/precondition');await ref.set({form:'10-K',discoveryPending:true});
    const [old]=await f.db.getAll(ref,{fieldMask:['form']});
    await ref.update({discoveryPending:false});
    await assert.rejects(ref.update({form:'stale'},{lastUpdateTime:old.updateTime!}),/precondition/);
    const current=await ref.get();await ref.update({form:'10-Q'},{lastUpdateTime:current.updateTime!});
    assert.equal((await ref.get()).get('form'),'10-Q');
    assert.equal((await ref.get()).get('discoveryPending'),false);
});

check('fundamentals gate preserves source through staged reads and independent cleanup authorization',async t=>{
 const f=fixture(true,false,true,true);t.after(()=>f.db.terminate());
 await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true,cleanedCollections:['tickers']});
 await f.raw.doc(FUNDAMENTALS_CONTROL).set({version:1,ready:false,cleanupAuthorized:false});
 const db=routeMarketFirestore(f.raw,f.repository),fund=db.doc('company_fundamentals/US:TEST'),ticker=db.doc('tickers/TEST');
 await db.batch().set(fund,{marketCap:{value:123},pending:true}).set(ticker,{symbol:'TEST'}).commit();
 assert.equal((await f.raw.doc(fund.path).get()).get('marketCap.value'),123,'global retirement must not strip fundamentals');
 assert.equal((await f.raw.doc(ticker.path).get()).exists,false);
 await f.raw.doc(fund.path).update({marketCap:{value:456}});
 assert.equal((await fund.get()).get('marketCap.value'),123,'candidate reads staged Parquet');
 await db.runTransaction(async tx=>{const [a,b]=await tx.getAll(fund,ticker);assert.equal(a.get('marketCap.value'),456,'transactions retain native fundamentals before cutover');assert.equal(b.get('symbol'),'TEST');tx.update(fund,{marketCap:{value:789}});});
 assert.equal((await f.raw.doc(fund.path).get()).get('marketCap.value'),789);
 await assert.rejects(cleanupMarketShard(f.raw,f.repository.files,'company_fundamentals',shardFor('US:TEST'),['US:TEST']),/verified cutover/);
 await f.raw.doc(FUNDAMENTALS_CONTROL).update({ready:true});
 await fund.update({marketCap:{value:900}});
 assert.equal((await f.raw.doc(fund.path).get()).get('marketCap.value'),900,'read cutover alone must not retire the source');
 await f.raw.doc(FUNDAMENTALS_CONTROL).update({cleanupAuthorized:true});
 await fund.update({marketCap:{value:901}});
 assert.equal((await f.raw.doc(fund.path).get()).get('marketCap'),undefined);
 assert.equal((await f.raw.doc(fund.path).get()).get('pending'),true);
 assert.equal((await fund.get()).get('marketCap.value'),901);
});

check('live fundamentals state bypasses Parquet scans while preserving shard data and notifications',async t=>{
 const f=fixture(false,false,true);t.after(()=>f.db.terminate());
 // This collection has an independent gate, even without a global control read.
 await f.raw.doc(FUNDAMENTALS_CONTROL).set({version:1,ready:true,cleanupAuthorized:false});
 const db=routeMarketFirestore(f.raw,f.repository),live=db.doc('company_fundamentals/_worker');
 let id='US:S0';for(let i=1;shardFor(id)!==shardFor('_worker');i++)id='US:S'+i;
 const external=db.doc('company_fundamentals/'+id);
 await db.batch().set(live,{leaseOwner:'first',leaseUntil:1}).set(external,{marketCap:{value:123},pending:false}).commit();
 const headRef=f.raw.collection('collectors').doc(headId('company_fundamentals',shardFor('_worker'))),before=(await headRef.get()).get('marketHead'),objects=f.objects.size;
 const read=f.repository.files.read.bind(f.repository.files),query=f.repository.files.query.bind(f.repository.files);
 f.repository.files.read=async()=>{throw Error('Live state must not decode a Parquet shard');};
 f.repository.files.query=async()=>{throw Error('Live state must not scan Parquet');};
 f.repository.invalidate();assert.equal((await live.get()).get('leaseOwner'),'first');
 await db.runTransaction(async tx=>{const doc=await tx.get(live);assert.equal(doc.get('leaseOwner'),'first');tx.update(live,{leaseOwner:'second',leaseUntil:FieldValue.increment(1)});});
 assert.equal((await live.get()).get('leaseOwner'),'second');assert.equal((await live.get()).get('leaseUntil'),2);
 const after=(await headRef.get()).get('marketHead');assert.equal(after.file,before.file);assert.equal(after.rows,before.rows);assert.notEqual(after.revision,before.revision);assert.equal(f.objects.size,objects);
 await f.raw.doc(live.path).update({leaseOwner:'third'});assert.equal((await live.get()).get('leaseOwner'),'third','live state must never reuse a stale Parquet result cache');
 f.repository.files.read=read;f.repository.files.query=query;
 assert.equal((await external.get()).get('marketCap.value'),123);
 // Completing a live record must still archive its external history.
 await live.set({completed:true,result:{ok:true}},{merge:true});
 assert.equal((await live.get()).get('result.ok'),true);assert.notEqual((await headRef.get()).get('marketHead.file'),before.file);
 await db.batch().update(external,{marketCap:{value:456}}).update(live,{verificationDuplicateRunId:'verified'}).commit();
 assert.equal((await external.get()).get('marketCap.value'),456);assert.equal((await live.get()).get('verificationDuplicateRunId'),'verified');
});

check('events gate preserves source through staged reads and independent cleanup authorization',async t=>{
 const f=fixture(true,false,false,false,true,true);t.after(()=>f.db.terminate());
 await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true,cleanedCollections:['tickers']});
 await f.raw.doc(EVENTS_CONTROL).set({version:1,ready:false,cleanupAuthorized:false});
 const db=routeMarketFirestore(f.raw,f.repository),fund=db.doc('events/US:TEST'),ticker=db.doc('tickers/TEST');
 await db.batch().set(fund,{title:{value:123},pending:true}).set(ticker,{symbol:'TEST'}).commit();
 assert.equal((await f.raw.doc(fund.path).get()).get('title.value'),123,'global retirement must not strip events');
 assert.equal((await f.raw.doc(ticker.path).get()).exists,false);
 await f.raw.doc(fund.path).update({title:{value:456}});
 assert.equal((await fund.get()).get('title.value'),123,'candidate reads staged Parquet');
 await db.runTransaction(async tx=>{const [a,b]=await tx.getAll(fund,ticker);assert.equal(a.get('title.value'),456,'transactions retain native events before cutover');assert.equal(b.get('symbol'),'TEST');tx.update(fund,{title:{value:789}});});
 assert.equal((await f.raw.doc(fund.path).get()).get('title.value'),789);
 await assert.rejects(cleanupMarketShard(f.raw,f.repository.files,'events',shardFor('US:TEST'),['US:TEST']),/verified cutover/);
 await f.raw.doc(EVENTS_CONTROL).update({ready:true});
 await fund.update({title:{value:900}});
 assert.equal((await f.raw.doc(fund.path).get()).get('title.value'),900,'read cutover alone must not retire the source');
 await f.raw.doc(EVENTS_CONTROL).update({cleanupAuthorized:true});
 await fund.update({title:{value:901}});
 assert.equal((await f.raw.doc(fund.path).get()).get('title'),undefined);
 assert.equal((await f.raw.doc(fund.path).get()).get('pending'),true);
 assert.equal((await fund.get()).get('title.value'),901);
});

check('events cutover preserves authored records and live processing state while archiving corrections',async t=>{
 const f=fixture(false,false,false,false,true);t.after(()=>f.db.terminate());
 await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
 await f.raw.doc(EVENTS_CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
 const db=routeMarketFirestore(f.raw,f.repository);
 const authored=db.doc('events/editorial'),live=db.doc('events/in-flight'),event=db.doc('events/news');
 await db.batch().set(authored,{title:'User correction',reviewedBy:'user-1',status:'published'})
  .set(live,{title:'Processing',status:'processing',leaseOwner:'worker',companyId:'US:NVDA'})
  .set(event,{title:'Original',companyId:'US:NVDA',type:'company_news',headlineTranslationPending:true,publication_date:'2026-11-16'}).commit();
 assert.equal((await f.raw.doc(authored.path).get()).get('title'),'User correction');
 assert.equal((await f.raw.doc(live.path).get()).get('title'),'Processing');
 assert.equal((await f.raw.doc(event.path).get()).get('title'),undefined);
 assert.equal((await f.raw.doc(event.path).get()).get('headlineTranslationPending'),true);
 await db.runTransaction(async tx=>{
  const snapshot=await tx.get(event);assert.equal(snapshot.get('title'),'Original');
  tx.update(event,{title:'Corrected',headlineTranslationPending:false,titleTranslations:{zh:'更正'}});
  tx.update(live,{status:'completed',leaseOwner:FieldValue.delete()});
 });
 assert.equal((await event.get()).get('titleTranslations.zh'),'更正');
 assert.equal((await f.raw.doc(event.path).get()).get('headlineTranslationPending'),false);
 assert.equal((await f.raw.doc(live.path).get()).get('title'),undefined);
 assert.equal((await live.get()).get('title'),'Processing');
 await event.update({title:'Reviewed correction',reviewedBy:'user-2'});
 assert.equal((await f.raw.doc(event.path).get()).get('title'),'Reviewed correction');
 assert.equal((await db.collection('events').where('companyId','==','US:NVDA').get()).size,2);
});
check('document caches survive unrelated shard commits but refresh affected shards and queries',async t=>{
 const f=fixture();t.after(()=>f.db.terminate());
 await f.raw.doc(CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
 const a='cached-company';let b='other-company';while(shardFor(b)===shardFor(a))b+='x';
 let collision='same-shard';while(shardFor(collision)!==shardFor(a))collision+='x';
 const ref=f.db.doc('company_directory/'+a),other=f.db.doc('company_directory/'+b);
 await ref.set({name:'Before'});await other.set({name:'Other'});
 let reads=0;const query=f.repository.files.query.bind(f.repository.files);
 f.repository.files.query=async(...args)=>{reads++;return query(...args);};
 assert.equal((await ref.get()).get('name'),'Before');
 await other.update({name:'Other changed'});
 const afterUnrelated=reads;
 assert.equal((await ref.get()).get('name'),'Before');
 assert.equal(reads,afterUnrelated,'an unrelated shard must not reread a cached document');
 const all=f.db.collection('company_directory').select('name');
 await all.get();await other.update({name:'Newest'});
 assert.equal((await all.get()).docs.find(doc=>doc.id===b)?.get('name'),'Newest','broad query invalidation must remain collection-wide');
 await f.db.doc('company_directory/'+collision).set({name:'Collision'});
 const afterSameShard=reads;await ref.get();assert(reads>afterSameShard,'same-shard updates conservatively invalidate document batches');
 await ref.update({name:'After'});assert.equal((await ref.get()).get('name'),'After');
 await ref.delete();assert.equal((await ref.get()).exists,false);
});
check('market-cap refresh updates only the published Parquet row',async t=>{
    const f=fixture(false,false,true);
    t.after(()=>f.db.terminate());
    const control=f.raw.doc(FUNDAMENTALS_CONTROL);
    const id='US:NVDA', collection='company_fundamentals';
    await control.set({version:1,ready:true,cleanupAuthorized:false});
    await assert.rejects(f.repository.updatePublishedMarketCap(id,()=>({value:1})),/retirement/);
    await control.set({version:1,ready:true,cleanupAuthorized:true,cleanedCollections:[collection]});
    await f.raw.doc(RETAINED_CONTROL).set({version:1,ready:true,cleanupAuthorized:true});
    await f.db.doc(collection+'/'+id).set({version:1,value:{issuer:'NVDA'},pending:true});
    const overlay=f.raw.doc(retainedPath('market_state',collection,id));
    const before=await overlay.get();
    assert.equal(before.get('pending'),true);
    await f.repository.updatePublishedMarketCap(id,data=>{
        assert.deepEqual(data.value,{issuer:'NVDA'});
        assert.equal(data.pending,undefined);
        return {value:123};
    });
    const [row]=await f.repository.documents(collection,[id],undefined,['value','version','marketCap']);
    assert.deepEqual(row.data,{value:{issuer:'NVDA'},version:1,marketCap:{value:123}});
    assert.ok(before.updateTime!.isEqual((await overlay.get()).updateTime!));
    assert.equal((await f.raw.doc(collection+'/'+id).get()).exists,false);
    f.fail();
    await assert.rejects(f.repository.updatePublishedMarketCap(id,()=>({value:456})),/upload failure/);
    assert.deepEqual((await f.repository.documents(collection,[id],undefined,['marketCap']))[0].data.marketCap,{value:123});
});
