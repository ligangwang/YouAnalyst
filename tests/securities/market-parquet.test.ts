import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import type { Bucket } from '@google-cloud/storage';
import { Timestamp, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { MarketFiles, shardFor, type MarketRow } from '../../src/lib/market-store/files';
import { MarketBlob } from '../../src/lib/market-store/blobs';
import { applyMutation, sortKey } from '../../src/lib/market-store/value';
import { splitRecord } from '../../src/lib/market-store/policy';
function fixture() { const objects = new Map<string, Buffer>(); const bucket = { file: (name: string) => ({ download: async (options?: {
            destination: string;
        }) => { const bytes = objects.get(name); if (!bytes)
            throw Error('Missing object'); if (options)
            await writeFile(options.destination, bytes); return [bytes]; }, save: async (bytes: Buffer) => { if (objects.has(name))
            throw Object.assign(Error('exists'), { code: 412 }); objects.set(name, bytes); } }), upload: async (path: string, options: {
        destination: string;
    }) => { assert(!objects.has(options.destination)); objects.set(options.destination, await readFile(path)); } } as unknown as Bucket; return new MarketFiles(bucket); }
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
