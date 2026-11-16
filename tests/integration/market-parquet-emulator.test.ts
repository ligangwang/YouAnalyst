import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Firestore, FieldValue, Timestamp, type Query } from '@google-cloud/firestore';
import type { Bucket } from '@google-cloud/storage';
import { MarketFiles } from '../../src/lib/market-store/files';
import { MarketRepository, CONTROL } from '../../src/lib/market-store/repository';
import { marketFirestore } from '../../src/lib/market-store/adapter';
import { observeFirestore } from '../../src/lib/firebase/firestore-observability';
import { reconcileMarketShard, cleanupMarketShard } from '../../src/lib/market-store/migration';
import { shardFor } from '../../src/lib/market-store/files';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host))
    throw Error('Local emulator required');
const check = host ? test : test.skip;
function fixture(stagedReads=false) {
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
    const raw = new Firestore({ projectId: 'demo-market-' + randomUUID().slice(0, 8) }), repository = new MarketRepository(raw, new MarketFiles(bucket),undefined,false,stagedReads);
    return { raw, repository, db: observeFirestore(marketFirestore(raw, repository), () => { }), fail: () => { fail = true; }, objects };
}
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
