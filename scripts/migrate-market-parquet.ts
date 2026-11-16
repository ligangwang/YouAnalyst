// Operator-only additive copy. Never removes or changes source documents.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath, Timestamp } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { mkdtemp, appendFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MARKET_COLLECTIONS, splitRecord, retainsRecord, type MarketCollection } from '../src/lib/market-store/policy';
import { MarketFiles, MARKET_ROOT, shardFor } from '../src/lib/market-store/files';
import { encodeMarket, decodeMarket } from '../src/lib/market-store/blobs';
import { CONTROL, headId } from '../src/lib/market-store/repository';
import {compactHead,pointerCollection,pointerId} from '../src/lib/market-store/head-pointer';
import { encode, decode } from '../src/lib/central-cache/codec';
type Saved = {
    id: string;
    data: unknown;
    version: unknown;
    retained: boolean;
    sourceHash: string;
    externalHash: string;
};
async function main() {
    const project = process.env.GOOGLE_CLOUD_PROJECT, bucketName = process.env.ENTITY_SNAPSHOT_BUCKET || process.env.EODHD_BULK_EOD_BUCKET;
    if (project !== 'ifindata-80905' || bucketName !== 'ifindata-80905-eodhd-bulk-eod')
        throw Error('Explicit production migration destination required');
    initializeApp({ projectId: project, credential: applicationDefault() });
    const db = getFirestore(), bucket = new Storage({ projectId: project }).bucket(bucketName), files = new MarketFiles(bucket);
    const control = db.doc(CONTROL), existing = await control.get();
    if (existing.exists && existing.get('ready') !== false)
        throw Error('Initial import cannot run after cutover');
    if (!existing.exists)
        await control.create({ version: 1, ready: false });
    const selected = process.env.MIGRATE_COLLECTIONS?.split(',') ?? [...MARKET_COLLECTIONS];
    if (selected.some(c => !MARKET_COLLECTIONS.includes(c as MarketCollection)))
        throw Error('Unapproved collection');
    const run = new Date().toISOString().replaceAll(':', '-'), audits = [];
    try {
        for (const collection of selected as MarketCollection[]) {
            const directory = await mkdtemp(join(tmpdir(), 'market-import-'));
            let cursor: string | undefined, count = 0, externalRows = 0, retainedRows = 0, bytes = 0;
            const fields = new Map<string, number>(), hash = createHash('sha256');
            const startedAt = new Date().toISOString();
            try {
                for (;;) {
                    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(collection === 'earnings_sources' ? 100 : 250);
                    if (cursor)
                        query = query.startAfter(cursor);
                    const page = await query.get();
                    if (page.empty)
                        break;
                    const groups = new Map<string, string[]>();
                    for (let offset = 0; offset < page.docs.length; offset += 32) {
                        const encoded = await Promise.all(page.docs.slice(offset, offset + 32).map(async (doc) => {
                            const data = doc.data(), split = splitRecord(collection, doc.id, data), sourceWire = JSON.stringify(encode(data)), externalWire = JSON.stringify(encode(split.external)), sourceHash = createHash('sha256').update(sourceWire).digest('hex');
                            const saved: Saved = { id: doc.id, data: await encodeMarket(split.external, bucket), version: encode(doc.updateTime), retained: retainsRecord(collection, doc.id, data, split.retained), sourceHash, externalHash: createHash('sha256').update(externalWire).digest('hex') };
                            return { saved, fields: Object.keys(data), bytes: Buffer.byteLength(externalWire), external: Object.keys(split.external).length > 0 || !saved.retained };
                        }));
                        for (const entry of encoded) {
                            const { saved } = entry;
                            for (const field of entry.fields)
                                fields.set(field, (fields.get(field) ?? 0) + 1);
                            bytes += entry.bytes;
                            if (entry.external)
                                externalRows++;
                            if (saved.retained)
                                retainedRows++;
                            count++;
                            hash.update(saved.id + '\n' + saved.sourceHash + '\n');
                            const shard = shardFor(saved.id), rows = groups.get(shard) ?? [];
                            rows.push(JSON.stringify(saved));
                            groups.set(shard, rows);
                        }
                    }
                    for (const [shard, rows] of groups)
                        await appendFile(join(directory, shard + '.jsonl'), rows.join('\n') + '\n');
                    cursor = page.docs.at(-1)!.id;
                    if (count % 1000 === 0)
                        console.info(JSON.stringify({ event: 'market_export_progress', collection, count, externalRows, retainedRows }));
                }
                let checked = 0;
                let nextShard = 0;
                await Promise.all(Array.from({ length: 4 }, async () => {
                    for (;;) {
                        const n = nextShard++;
                        if (n >= 256)
                            return;
                        const shard = n.toString(16).padStart(2, '0');
                        let content: string;
                        try {
                            content = await readFile(join(directory, shard + '.jsonl'), 'utf8');
                        }
                        catch (error) {
                            if ((error as {
                                code?: string;
                            }).code !== 'ENOENT')
                                throw error;
                            content = '';
                        }
                        const saved = content.trim() ? content.trim().split('\n').map(line => JSON.parse(line) as Saved) : [];
                        const rows = saved.filter(row => !row.retained || Object.keys(decodeMarket(row.data)).length).map(row => ({ id: row.id, data: decodeMarket(row.data), version: decode(row.version) as Timestamp }));
                        const head = await files.write(collection, shard, rows, saved.filter(row => row.retained).map(row => row.id));
                        const roundtrip = await files.read(head);
                        if (!isDeepStrictEqual(roundtrip.toSorted((a, b) => a.id.localeCompare(b.id)), rows.toSorted((a, b) => a.id.localeCompare(b.id))))
                            throw Error(`Parquet parity mismatch ${collection}/${shard}`);
                        await bucket.file(`${MARKET_ROOT}/operator/${run}/${collection}/${shard}.jsonl.gz`).save(gzipSync(content), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/gzip' } });
                        // The initial source stays authoritative throughout this pre-deploy copy.
                        const batch=db.batch();
                        batch.set(db.collection('collectors').doc(headId(collection, shard)),{marketCollection:collection,marketHead:head});
                        batch.set(db.collection('collectors').doc(pointerId(collection,shard)),{marketCollection:pointerCollection(collection),marketHead:compactHead(head)});
                        await batch.commit();
                        checked += saved.length;
                    }
                }));
                if (checked !== count)
                    throw Error('Incomplete source inventory');
                const countAfter = (await db.collection(collection).count().get()).data().count;
                const audit = { collection, startedAt, completedAt: new Date().toISOString(), sourceRows: count, sourceCountAfter: countAfter, externalRows, retainedRows, checked, externalBytes: bytes, sourceHash: hash.digest('hex'), fields: Object.fromEntries(fields), operatorRoot: `${MARKET_ROOT}/operator/${run}/${collection}`, firestoreSourceWrites: 0 };
                audits.push(audit);
                await bucket.file(`${MARKET_ROOT}/operator/${run}/${collection}/audit.json`).save(JSON.stringify(audit), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/json' } });
                console.info(JSON.stringify({ event: 'market_collection_copied', ...audit }));
            }
            finally {
                await rm(directory, { recursive: true, force: true });
            }
        }
        await bucket.file(`${MARKET_ROOT}/operator/${run}/audit.json`).save(JSON.stringify(audits), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/json' } });
        console.info(JSON.stringify({ event: 'market_initial_copy_complete', operatorRoot: `${MARKET_ROOT}/operator/${run}`, collections: audits.length }));
    }
    finally {
        await files.close();
        await db.terminate();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
