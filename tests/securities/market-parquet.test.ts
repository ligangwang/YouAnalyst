import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import type { Bucket } from '@google-cloud/storage';
import { Timestamp, FieldValue, FieldPath, type Firestore } from 'firebase-admin/firestore';
import {MarketRepository,headId} from '../../src/lib/market-store/repository';
import {CleanupGate,capacityRegression} from '../../scripts/market-migration-safety';
import { MarketFiles, shardFor, type MarketRow } from '../../src/lib/market-store/files';
import { MarketBlob } from '../../src/lib/market-store/blobs';
import {PrefixCache} from '../../src/lib/market-store/prefix-cache';
import { applyMutation, sortKey } from '../../src/lib/market-store/value';
import { splitRecord } from '../../src/lib/market-store/policy';
function fixture(downloads:string[] = []) { const objects = new Map<string, Buffer>(); const bucket = { file: (name: string) => ({ download: async (options?: {
            destination: string;
        }) => { downloads.push(name); const bytes = objects.get(name); if (!bytes)
            throw Error('Missing object'); if (options)
            await writeFile(options.destination, bytes); return [bytes]; }, save: async (bytes: Buffer) => { if (objects.has(name))
            throw Object.assign(Error('exists'), { code: 412 }); objects.set(name, bytes); } }), upload: async (path: string, options: {
        destination: string;
    }) => { assert(!objects.has(options.destination)); objects.set(options.destination, await readFile(path)); } } as unknown as Bucket; return new MarketFiles(bucket); }
test('prefix bytes preserve exact membership, reuse generations and evict within the budget',async()=>{
    let loads=0;const cache=new PrefixCache(),load=async()=>{loads++;return [{id:'a',values:['nvda','nv','英伟达','nvda']},{id:'b',values:['amd','nvda-x','bad\0nvda\0value']},{id:'c',values:['nvda']}];};
    assert.deepEqual(await cache.matching('generation1','nvda',load),['a','c']);
    assert.deepEqual(await cache.matching('generation1','英伟达',load),['a']);
    assert.deepEqual(await cache.matching('generation1','amd',load),['b']);assert.equal(loads,1);
    assert.deepEqual(await cache.matching('generation2','nvda',async()=>[{id:'b',values:['nvda']}]),['b']);
    const tiny=new PrefixCache(1);await tiny.matching('generation1','amd',load);await tiny.matching('generation1','amd',load);assert.equal(loads,3);
});
test('prefix candidate lookup preserves other predicates, order, projection and new head contents',async()=>{
    const files=fixture(),version=Timestamp.now();
    const rows=Array.from({length:12},(_,i)=>({id:'prefix-'+i,version,data:{searchPrefixes:[i%2?'amd':'nvda','英伟达'],score:i,name:'Company '+i}}));
    try{
        const heads=[];for(const shard of new Set(rows.map(row=>shardFor(row.id))))heads.push(await files.write('companies',shard,rows.filter(row=>shardFor(row.id)===shard),[]));
        const steps=[{method:'where',args:['searchPrefixes','array-contains','nvda']},{method:'where',args:['score','>=',4]},{method:'orderBy',args:['score','desc']},{method:'limit',args:[2]},{method:'select',args:['name']}];
        assert.deepEqual(await files.query(heads,steps),await files.filter(rows,steps));
        const old=heads[0],oldRows=rows.filter(row=>shardFor(row.id)===old.shard);
        const next=await files.write('companies',old.shard,oldRows.map(row=>({...row,data:{...row.data,searchPrefixes:['changed']}})),[]);
        const updated=[next,...heads.slice(1)];
        assert.deepEqual((await files.query(updated,[{method:'where',args:['searchPrefixes','array-contains','changed']}])).map(row=>row.id).sort(),oldRows.map(row=>row.id).sort());
        assert.equal((await files.query([next],[{method:'where',args:['searchPrefixes','array-contains','nvda']}])).length,0);
    }finally{await files.close();}
});
test('Parquet round trips timestamps, bytes, nested arrays and query semantics', async () => {
    const files = fixture(), version = new Timestamp(1794770000, 123);
    const ids = Array.from({ length: 40 }, (_, i) => 'record-' + i);
    const rows: MarketRow[] = ids.map((id, i) => ({ id, version, data: { ticker: i % 2 ? 'NVDA' : 'AMD', score: i, tags: i % 3 ? ['ai', 'us'] : ['cn'], time: new Timestamp(10, i), nested: { text: 'quote\' \\ 中文' }, bytes: Buffer.from([0, 1, 255]), nullable: null } }));
    try {
        const heads = [];
        for (const shard of new Set(ids.map(shardFor)))
            heads.push(await files.write('events', shard, rows.filter(r => shardFor(r.id) === shard), []));
        const all = (await Promise.all(heads.map(head => files.read(head)))).flat().sort((a, b) => a.id.localeCompare(b.id));
        assert.deepEqual(all, rows.toSorted((a, b) => a.id.localeCompare(b.id)));
        const selected = await files.query(heads, [{ method: 'where', args: ['ticker', '==', 'NVDA'] }, { method: 'where', args: ['score', '>=', 10] }, { method: 'orderBy', args: ['score', 'desc'] }, { method: 'limit', args: [3] }]);
        assert.deepEqual(selected.map(r => r.data.score), [39, 37, 35]);
        const arrays = await files.query(heads, [{ method: 'where', args: ['tags', 'array-contains', 'cn'] }, { method: 'orderBy', args: ['score'] }, { method: 'startAfter', args: [12] }, { method: 'limit', args: [2] }]);
        assert.deepEqual(arrays.map(r => r.data.score), [15, 18]);
        const projected = await files.query(heads, [{ method: 'where', args: [FieldPath.documentId(), 'in', ['record-1', 'record-2']] }, { method: 'select', args: ['nested.text'] }]);
        assert.deepEqual(projected.map(r => r.data), [{ nested: { text: 'quote\' \\ 中文' } }, { nested: { text: 'quote\' \\ 中文' } }]);
        const last = await files.query(heads, [{ method: 'orderBy', args: ['score'] }, { method: 'limitToLast', args: [2] }]);
        assert.deepEqual(last.map(r => r.data.score), [38, 39]);
    }
    finally {
        await files.close();
    }
});
test('transforms preserve merge, replace, field paths, timestamps and preconditions', () => {
    const at = new Timestamp(42, 123), before = { nested: { keep: 1, change: 2 }, list: ['a'], counter: 3 };
    assert.deepEqual(applyMutation(before, 'set', [{ nested: { change: 4 } }, { merge: true }], at), { ...before, nested: { keep: 1, change: 4 } });
    assert.deepEqual(applyMutation(before, 'update', [{ 'nested.change': FieldValue.delete(), counter: FieldValue.increment(2), list: FieldValue.arrayUnion('a', 'b'), stamp: FieldValue.serverTimestamp() }], at), { nested: { keep: 1 }, counter: 5, list: ['a', 'b'], stamp: at });
    assert.deepEqual(applyMutation(before, 'set', [{ fresh: true }], at), { fresh: true });
    assert.throws(() => applyMutation(undefined, 'update', [{ fresh: true }], at));
    assert.throws(() => applyMutation(before, 'create', [{}], at));
    const ordered = [-Infinity, -9, -0, 0, 0.01, 100, Infinity];
    assert.deepEqual(ordered.map(sortKey).toSorted(), ordered.map(sortKey));
    assert(sortKey(new Timestamp(1, 1))! < sortKey(new Timestamp(1, 2))!);
});
test('compact predicates and projections avoid downloading full payload shards',async()=>{
    const downloads:string[]=[],files=fixture(downloads);
    try{
        const row={id:'event',version:Timestamp.now(),data:{companyIds:['US:NVDA'],name:'Announcement',date:'2026-11-13',body:'large article '.repeat(20000)}};
        const head=await files.write('events',shardFor(row.id),[row],[]);
        const projected=await files.query([head],[{method:'where',args:['companyIds','array-contains','US:NVDA']},{method:'select',args:['name','date']}]);
        assert.deepEqual(projected[0].data,{name:'Announcement',date:'2026-11-13'});
        assert(downloads.includes(head.indexFile!));assert(!downloads.includes(head.file!));
        const full=await files.query([head],[{method:'where',args:['companyIds','array-contains','US:NVDA']}]);
        assert.deepEqual(full[0].data,row.data);assert(downloads.includes(head.file!));
        const fallback=await files.query([head],[{method:'where',args:['body','==',row.data.body]}]);
        assert.equal(fallback.length,1);
        const calendar={...row,id:'calendar',data:{type:'scheduled_event',scheduled_date:'2026-11-13',confirmation:'official',dateEvidence:'Company announcement'}};
        const calendarHead=await files.write('events',shardFor(calendar.id),[calendar],[]);
        const schedule=await files.query([calendarHead],[{method:'where',args:['type','==','scheduled_event']}]);
        assert.deepEqual(schedule[0].data,calendar.data);assert(!downloads.includes(calendarHead.file!));
    }finally{await files.close();}
});
test('UGC, active queues, leases and deduplication stay in Firestore', () => {
    const ugc = { status: 'PUBLISHED', createdBy: 'user', description: 'authored' };
    assert.deepEqual(splitRecord('companies', 'US:EXAMPLE', ugc), { external: {}, retained: ugc });
    const source = { recordType: 'source', status: 'processing', source: { url: 'https://example.com' }, leaseOwner: 'worker' };
    assert.deepEqual(splitRecord('earnings_sources', 'earnings_source_1', source).retained, source);
    const fundamentals = { value: { revenue: 100 }, pending: true, requestedAt: 'now', cnLeaseOwner: 'owner' };
    assert.deepEqual(splitRecord('company_fundamentals', 'US:EXAMPLE', fundamentals), { external: { value: { revenue: 100 } }, retained: { pending: true, requestedAt: 'now', cnLeaseOwner: 'owner' } });
    const filing = { form: '10-K', discoveryPending: true, discoveryEvents: { delivery: { state: 'pending' } } };
    assert.deepEqual(splitRecord('sec_filings', 'accession', filing), { external: { form: '10-K' }, retained: { discoveryPending: true, discoveryEvents: filing.discoveryEvents } });
    const history = { completed: true, request: { eventId: 'dedup' }, result: { records: 20 } };
    assert.deepEqual(splitRecord('company_fundamentals', '_finished_work', history), { external: { result: { records: 20 } }, retained: { completed: true, request: { eventId: 'dedup' } } });
});
test('large binary captures stay in GCS and only selected records hydrate their bytes', async () => {
    const files = fixture(), data = { recordType: 'raw_chunk', bytes: Buffer.alloc(400000, 42) }, row = { id: 'chunk', data, version: Timestamp.now() };
    try {
        const head = await files.write('earnings_sources', shardFor(row.id), [row], []), stored = await files.read(head);
        assert(stored[0].data.bytes instanceof MarketBlob);
        assert.deepEqual((await files.hydrate(stored[0])).data, data);
        const second = await files.write('earnings_sources', head.shard, stored, []);
        assert.deepEqual((await files.hydrate((await files.read(second))[0])).data, data);
    }
    finally {
        await files.close();
    }
});
test('a local shard refresh cannot hide another shard in an older listener snapshot',async()=>{
    const files=fixture(),a=shardFor('a'),b=shardFor('b');assert.notEqual(a,b);
    const doc=(shard:string,revision:string,seconds:number)=>({exists:true,id:headId('events',shard),readTime:new Timestamp(seconds,0),get:(field:string)=>field==='marketHead.shard'?shard:{collection:'events',shard,rows:0,retained:[],revision}});
    let emit: (snapshot:{readTime:Timestamp;docs:ReturnType<typeof doc>[]})=>void=()=>{throw Error('Listener not connected');};
    const raw={collection:()=>({doc:(id:string)=>({id}),where:()=>({onSnapshot:(next:typeof emit)=>{emit=next;return()=>{};}})}),getAll:async()=>[doc(a,'a-new',30)]} as unknown as Firestore;
    const repo=new MarketRepository(raw,files);
    try{
        const initial=repo.heads('events');emit({readTime:new Timestamp(10,0),docs:[doc(a,'a-old',10),doc(b,'b-old',10)]});await initial;
        await repo.committed(['events/a']);
        emit({readTime:new Timestamp(20,0),docs:[doc(a,'a-old',20),doc(b,'b-new',20)]});
        const heads=await repo.heads('events');assert.equal(heads.get(a)?.revision,'a-new');assert.equal(heads.get(b)?.revision,'b-new');
    }finally{await repo.close();}
});
test('cleanup capacity failures latch closed and queue growth cannot pass a healthy endpoint',async()=>{
    const base={requestErrors:0,backlogs:{cache:10}};
    assert.equal(capacityRegression(base,{requestErrors:0,backlogs:{cache:20}}),undefined);
    assert.match(capacityRegression(base,{requestErrors:0,backlogs:{cache:111}})!,/backlog/);
    let samples=0;const gate=new CleanupGate(async()=>{samples++;return {requestErrors:1,backlogs:{cache:0}};});
    await assert.rejects(gate.before(1),/request errors/);await assert.rejects(gate.before(1),/request errors/);assert.equal(samples,1);
});
