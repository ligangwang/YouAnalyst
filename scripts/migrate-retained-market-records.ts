import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializeApp, applicationDefault} from 'firebase-admin/app';
import {getFirestore, type Firestore} from 'firebase-admin/firestore';
import {pathToFileURL} from 'node:url';
import {Storage} from '@google-cloud/storage';
import {mergeMarketOverlay} from '../src/lib/market-store/policy';
import {MarketFiles, shardFor, type MarketHead, type MarketRow} from '../src/lib/market-store/files';
import {headId, CONTROL} from '../src/lib/market-store/repository';
import {compactHead, pointerCollection, pointerId} from '../src/lib/market-store/head-pointer';
import {retainedMode, RETAINED_CONTROL, retainedPath} from '../src/lib/market-store/retained-store';
import {fundamentalsMode, FUNDAMENTALS_CONTROL} from '../src/lib/market-store/fundamentals-control';
import {CleanupGate, migrationCapacity} from './market-migration-safety';

type Collection = 'company_relationships' | 'company_fundamentals' | 'earnings_records';
const project = 'ifindata-80905';

export async function migrateMarketRecords(
    db: Firestore, files: MarketFiles, capacity: Pick<CleanupGate, 'before'>,
    {collection, start, end, apply}: {collection: Collection; start: number; end: number; apply: boolean},
) {
    assert(collection === 'company_relationships' || collection === 'company_fundamentals' || collection === 'earnings_records');
    assert(Number.isInteger(start) && Number.isInteger(end) && 0 <= start && start < end && end <= 256);
    try {
        for (let n = start; n < end; n++) {
            const shard = n.toString(16).padStart(2, '0');
            if (apply) await capacity.before(2);
            const moved = await db.runTransaction(async tx => {
                const catalog = db.collection('collectors'), ref = catalog.doc(headId(collection, shard));
                const controlPath = collection === 'company_fundamentals' ? FUNDAMENTALS_CONTROL : CONTROL;
                const [stored, control, retained] = await tx.getAll(ref, db.doc(controlPath), db.doc(RETAINED_CONTROL));
                if (collection === 'company_fundamentals') {
                    const mode = fundamentalsMode(control);
                    assert(mode.ready && mode.cleanupAuthorized && mode.cleanedCollections.has(collection));
                } else {
                    assert(control.get('ready') && control.get('cleanupAuthorized')
                        && control.get('cleanedCollections').includes(collection));
                }
                const mode = retainedMode(retained);
                assert(mode.ready && mode.cleanupAuthorized);
                const head = stored.get('marketHead') as MarketHead;
                assert(head.collection === collection && head.shard === shard);
                if (head.recordStorage === 'parquet') return {moved: 0, sources: []};

                const ids = head.retained;
                const refs = ids.flatMap(id => {
                    assert.equal(shardFor(id), shard);
                    return [db.doc(retainedPath('market_state', collection, id)),
                        db.doc(retainedPath('market_ugc', collection, id)), db.collection(collection).doc(id)];
                });
                const snapshots = refs.length ? await tx.getAll(...refs) : [];
                const rows = new Map((await files.read(head)).map(row => [row.id, row]));
                const movedRows = new Map<string, MarketRow>();
                const sources: {path: string; seconds: number; nanos: number}[] = [];
                for (let i = 0; i < ids.length; i++) {
                    const [state, ugc, legacy] = snapshots.slice(i * 3, i * 3 + 3);
                    assert(!legacy.exists && state.exists !== ugc.exists, 'Unexpected source placement');
                    const source = state.exists ? state : ugc;
                    const prior = rows.get(source.id);
                    const published = prior ? (await files.hydrate(prior)).data : {};
                    const row = {id: source.id, data: mergeMarketOverlay(collection, published, source.data()), version: source.updateTime!};
                    rows.set(row.id, row);
                    movedRows.set(row.id, row);
                    sources.push({path: source.ref.path, seconds: row.version.seconds, nanos: row.version.nanoseconds});
                }
                if (!apply) return {moved: movedRows.size, sources: []};
                const next: MarketHead = movedRows.size
                    ? await files.write(collection, shard, [...rows.values()], []) : {...head, retained: []};
                if (movedRows.size) {
                    const roundTrip = new Map((await files.read(next)).map(row => [row.id, row]));
                    assert.equal(roundTrip.size, rows.size);
                    for (const [id, expected] of movedRows) {
                        const actual = await files.hydrate(roundTrip.get(id)!);
                        assert.deepEqual(actual.data, expected.data);
                        assert(actual.version.isEqual(expected.version));
                    }
                }
                next.recordStorage = 'parquet';
                next.revision = randomUUID();
                tx.set(ref, {marketCollection: collection, marketHead: next});
                tx.set(catalog.doc(pointerId(collection, shard)), {
                    marketCollection: pointerCollection(collection), marketHead: compactHead(next),
                });
                // Retain original versions through live read verification. Their
                // deletion can then be conditioned on their unchanged update time.
                return {moved: movedRows.size, sources};
            });
            console.log(JSON.stringify({collection, shard, apply, ...moved}));
        }
    } finally {
        await files.close();
        await db.terminate();
    }
}

async function main() {
    assert.equal(process.env.GOOGLE_CLOUD_PROJECT, project);
    assert(!process.env.FIRESTORE_EMULATOR_HOST);
    initializeApp({projectId: project, credential: applicationDefault()});
    const files = new MarketFiles(new Storage({projectId: project}).bucket('ifindata-80905-eodhd-bulk-eod'));
    await migrateMarketRecords(getFirestore(), files, new CleanupGate(migrationCapacity(project), 20), {
        collection: (process.env.MARKET_COLLECTION ?? 'company_relationships') as Collection,
        start: Number(process.env.START_SHARD ?? 0),
        end: Number(process.env.END_SHARD ?? 256),
        apply: process.argv.includes('--apply'),
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main().catch(error => { console.error(error); process.exitCode = 1; });
