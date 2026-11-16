import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath, FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { gunzipSync, gzipSync } from 'node:zlib';
import { MarketFiles, MARKET_ROOT, shardFor, type MarketRow, type MarketHead } from '../src/lib/market-store/files';
import { MARKET_COLLECTIONS, type MarketCollection } from '../src/lib/market-store/policy';
import { CONTROL, headId, MarketRepository } from '../src/lib/market-store/repository';
import { isDeepStrictEqual } from 'node:util';
import { reconcileMarketShard, cleanupMarketShard, sameVersion } from '../src/lib/market-store/migration';
import { decode, encode } from '../src/lib/central-cache/codec';
import { decodeMarket } from '../src/lib/market-store/blobs';
async function main() {
    const project = process.env.GOOGLE_CLOUD_PROJECT, bucketName = process.env.ENTITY_SNAPSHOT_BUCKET;
    if (project !== 'ifindata-80905' || bucketName !== 'ifindata-80905-eodhd-bulk-eod')
        throw Error('Explicit migration destination required');
    initializeApp({ projectId: project, credential: applicationDefault() });
    const db = getFirestore(), bucket = new Storage().bucket(bucketName), files = new MarketFiles(bucket);
    const mode = process.env.MARKET_OPERATION, baseline = process.env.MARKET_BASELINE_ROOT;
    const run = `${MARKET_ROOT}/operator/${new Date().toISOString().replaceAll(':', '-')}`;
    const save = async (name: string, value: unknown) => bucket.file(`${run}/${name}.json`).save(JSON.stringify(value), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/json' } });
    const health = async () => { const response = await fetch('https://ifindata-web-zcgfwde4aa-uc.a.run.app/api/health', { signal: AbortSignal.timeout(15000) }); if (!response.ok)
        throw Error('Production health failed'); const body = await response.json(); if (body.status !== 'ok')
        throw Error('Production health degraded'); return body; };
    try {
        if (mode === 'upgrade') {
            const selected = process.env.MARKET_UPGRADE_COLLECTIONS?.split(',') ?? [];
            if (!selected.length || selected.some(c => !MARKET_COLLECTIONS.includes(c as MarketCollection)))
                throw Error('Explicit copied collection scope required');
            for (const collection of selected as MarketCollection[]) {
                let cursor = 0, updated = 0;
                await Promise.all(Array.from({ length: 4 }, async () => {
                    for (;;) {
                        const index = cursor++;
                        if (index >= 256)
                            return;
                        const shard = index.toString(16).padStart(2, '0');
                        await db.runTransaction(async (tx) => {
                            if ((await tx.get(db.doc(CONTROL))).get('ready') !== false)
                                throw Error('File upgrade requires bootstrap mode');
                            const ref = db.collection('collectors').doc(headId(collection, shard)), head = (await tx.get(ref)).get('marketHead');
                            if (!head)
                                throw Error('Initial shard copy is incomplete');
                            if (head.format === 3)
                                return;
                            const rows = await files.read(head), next = await files.write(collection, shard, rows, head.retained);
                            if (!isDeepStrictEqual(await files.read(next), rows))
                                throw Error('File upgrade changed data');
                            tx.set(ref, { marketCollection: collection, marketHead: next });
                        });
                        updated++;
                    }
                }));
                console.info(JSON.stringify({ event: 'market_files_upgraded', collection, updated }));
            }
            return;
        }
        if (mode === 'probe') {
            const repo = new MarketRepository(db, files);
            try {
                for (const [collection, steps] of [
                    ['companies', [{ method: 'select', args: ['name', 'slug', 'status', 'market', 'isDeleted', 'source', 'sourceLabel'] }]],
                    ['companies', [{ method: 'where', args: [FieldPath.documentId(), '==', 'US:NVDA'] }]],
                    ['company_directory', [{ method: 'limit', args: [25] }]],
                    ['events', [{ method: 'where', args: ['companyIds', 'array-contains', 'US:NVDA'] }, { method: 'limit', args: [20] }]],
                ] as const) {
                    for (let sample = 0; sample < 3; sample++) {
                        const start = performance.now();
                        const rows = await repo.query(collection, steps.map(s => ({ method: s.method, args: [...s.args] })));
                        console.info(JSON.stringify({ event: 'market_probe', collection, steps: steps.map(s => s.method), sample, rows: rows.length, ms: performance.now() - start, rss: process.memoryUsage().rss }));
                    }
                }
            }
            finally {
                await repo.close();
            }
            return;
        }
        if (!['reconcile', 'cleanup'].includes(String(mode)))
            throw Error('Explicit operator mode required');
        if (!baseline || !/^market-parquet\/v1\/operator\/[\dTZ.:-]+$/.test(baseline))
            throw Error('Verified initial-copy root required');
        const [auditBytes] = await bucket.file(baseline + '/audit.json').download();
        const audits = JSON.parse(auditBytes.toString()) as Array<{
            collection: MarketCollection;
            sourceRows: number;
            operatorRoot: string;
        }>;
        if (audits.length !== MARKET_COLLECTIONS.length || MARKET_COLLECTIONS.some(c => !audits.some(a => a.collection === c)))
            throw Error('Incomplete initial-copy audit');
        if (mode === 'cleanup') {
            const proof = process.env.MARKET_VERIFICATION_PROOF;
            if (!proof?.startsWith(MARKET_ROOT + '/operator/'))
                throw Error('Production verification proof required');
            const [bytes] = await bucket.file(proof).download(), verified = JSON.parse(bytes.toString()), live = await health();
            if (verified.commit !== live.commitSha || verified.uiPassed !== true || verified.apiPassed !== true || verified.performancePassed !== true || verified.baseline !== baseline)
                throw Error('Verification proof does not match production and migration');
        }
        const results = [];
        for (const collection of MARKET_COLLECTIONS) {
            await health();
            const initial = audits.find(a => a.collection === collection)!;
            const versions = new Map<string, Timestamp | undefined>();
            const emptyRecords = new Set<string>();
            let shardCursor = 0;
            await Promise.all(Array.from({ length: 8 }, async () => { for (;;) {
                const n = shardCursor++;
                if (n >= 256)
                    return;
                const shard = n.toString(16).padStart(2, '0');
                const [bytes] = await bucket.file(`${initial.operatorRoot}/${shard}.jsonl.gz`).download();
                const text = gunzipSync(bytes).toString();
                for (const line of text.trim() ? text.trim().split('\n') : []) {
                    const row = JSON.parse(line);
                    versions.set(row.id, decode(row.version) as Timestamp);
                    if (!Object.keys(decodeMarket(row.data)).length)
                        emptyRecords.add(row.id);
                }
            } }));
            if (versions.size !== initial.sourceRows)
                throw Error('Incomplete initial source ledger');
            const current = new Map<string, Timestamp | undefined>();
            let cursor: string | undefined;
            for (;;) {
                let query = db.collection(collection).select().orderBy(FieldPath.documentId()).limit(1000);
                if (cursor)
                    query = query.startAfter(cursor);
                const page = await query.get();
                if (page.empty)
                    break;
                for (const doc of page.docs)
                    current.set(doc.id, doc.updateTime);
                cursor = page.docs.at(-1)!.id;
            }
            // Instrument onboarding is operational even though its instrument payload is
            // external. Reclassify the initial v2 export before enabling Parquet reads.
            const ids = mode === 'cleanup' ? [...current.keys()] : [...new Set([...current.keys(), ...versions.keys()])].filter(id => collection === 'instruments' || emptyRecords.has(id) || !sameVersion(current.get(id), versions.get(id)));
            const groups = new Map<string, string[]>();
            for (const id of ids) {
                const shard = shardFor(id), group = groups.get(shard) ?? [];
                group.push(id);
                groups.set(shard, group);
            }
            const entries = [...groups];
            let next = 0, processed = 0, deleted = 0, stripped = 0, retained = 0;
            await Promise.all(Array.from({ length: 4 }, async () => {
                for (;;) {
                    const index = next++;
                    if (index >= entries.length)
                        return;
                    const [shard, group] = entries[index], cache: {
                        file?: string;
                        rows?: Map<string, MarketRow>;
                    } = {};
                    for (let offset = 0; offset < group.length; offset += collection === 'earnings_sources' ? 10 : 100) {
                        await health();
                        const batch = group.slice(offset, offset + (collection === 'earnings_sources' ? 10 : 100));
                        if (mode === 'reconcile') {
                            for (const row of await reconcileMarketShard(db, files, collection, shard, batch)) {
                                if (row.version)
                                    current.set(row.id, row.version);
                                else
                                    current.delete(row.id);
                            }
                        }
                        else {
                            const result = await cleanupMarketShard(db, files, collection, shard, batch, cache);
                            deleted += result.deleted;
                            stripped += result.stripped;
                            retained += result.retained;
                        }
                        processed += batch.length;
                    }
                    console.info(JSON.stringify({ event: 'market_operator_progress', mode, collection, processed, total: ids.length, deleted, stripped, retained }));
                }
            }));
            if (mode === 'reconcile')
                await bucket.file(`${run}/${collection}/ledger.json.gz`).save(gzipSync(JSON.stringify([...current].map(([id, version]) => ({ id, version: encode(version) })))), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
            let verifiedIds: number | undefined;
            if (mode === 'reconcile') {
                // One read-only Firestore snapshot covers both source identities and heads;
                // immutable files can then be inspected outside the transaction safely.
                const consistent = await db.runTransaction(async (tx) => {
                    const source = await tx.get(db.collection(collection).select());
                    const heads = await tx.get(db.collection('collectors').where('marketCollection', '==', collection));
                    return { ids: new Set(source.docs.map(doc => doc.id)), heads: heads.docs.map(doc => doc.get('marketHead') as MarketHead) };
                }, { readOnly: true });
                if (consistent.heads.length !== 256)
                    throw Error('Incomplete shard inventory');
                const stored = new Set(consistent.heads.flatMap(head => head.retained));
                let nextHead = 0;
                await Promise.all(Array.from({ length: 4 }, async () => { for (;;) {
                    const index = nextHead++;
                    if (index >= consistent.heads.length)
                        return;
                    for (const row of await files.read(consistent.heads[index]))
                        stored.add(row.id);
                } }));
                if (stored.size !== consistent.ids.size || [...stored].some(id => !consistent.ids.has(id)))
                    throw Error(`Identity parity failed: ${collection}`);
                verifiedIds = stored.size;
            }
            const result = { collection, mode, sourceRows: current.size, verifiedIds, processed, deleted, stripped, retained };
            if(mode==='cleanup')await db.doc(CONTROL).update({cleanedCollections:FieldValue.arrayUnion(collection)});
            results.push(result);
            await save(collection + '/audit', result);
            console.info(JSON.stringify({ event: 'market_operator_collection_complete', ...result }));
        }
        const result = { mode, baseline, operatorRoot: run, results, completedAt: new Date().toISOString(), health: await health() };
        await save('audit', result);
        console.info(JSON.stringify({ event: 'market_operator_complete', ...result }));
    }
    finally {
        await files.close();
        await db.terminate();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
