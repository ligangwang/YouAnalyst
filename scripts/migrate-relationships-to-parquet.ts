import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Firestore} from '@google-cloud/firestore';
import {createRequire} from 'node:module';
import {Storage} from '@google-cloud/storage';
import {MarketFiles, shardFor, type MarketHead, type MarketRow} from '../src/lib/market-store/files';
import {headId, CONTROL} from '../src/lib/market-store/repository';
import {compactHead, pointerCollection, pointerId} from '../src/lib/market-store/head-pointer';
import {retainedMode, RETAINED_CONTROL, retainedPath} from '../src/lib/market-store/retained-store';
import {CleanupGate, migrationCapacity} from './market-migration-safety';

const collection = 'company_relationships';
const project = 'ifindata-80905';

async function main() {
    assert.equal(process.env.GOOGLE_CLOUD_PROJECT, project);
    assert(!process.env.FIRESTORE_EMULATOR_HOST);
    const apply = process.argv.includes('--apply');
    const start = Number(process.env.START_SHARD ?? 0), end = Number(process.env.END_SHARD ?? 256);
    assert(Number.isInteger(start) && Number.isInteger(end) && 0 <= start && start < end && end <= 256);
    const require = createRequire(import.meta.url);
    // Use the same auth library instance as the Firestore transport.
    const {GoogleAuth, OAuth2Client} = require(require.resolve('google-auth-library', {
        paths: [require.resolve('google-gax')],
    })) as typeof import('google-auth-library');
    const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    const auth = token ? new OAuth2Client() : undefined;
    auth?.setCredentials({access_token: token});
    const db = new Firestore({projectId: project, auth: auth && new GoogleAuth({projectId: project, authClient: auth})});
    const files = new MarketFiles(new Storage({projectId: project, authClient: auth}).bucket('ifindata-80905-eodhd-bulk-eod'));
    const capacity = new CleanupGate(migrationCapacity(project, auth), 20);
    try {
        for (let n = start; n < end; n++) {
            const shard = n.toString(16).padStart(2, '0');
            if (apply) await capacity.before(2);
            const moved = await db.runTransaction(async tx => {
                const catalog = db.collection('collectors'), ref = catalog.doc(headId(collection, shard));
                const [stored, control, retained] = await tx.getAll(ref, db.doc(CONTROL), db.doc(RETAINED_CONTROL));
                assert(control.get('ready') && control.get('cleanupAuthorized')
                    && control.get('cleanedCollections').includes(collection));
                const mode = retainedMode(retained);
                assert(mode.ready && mode.cleanupAuthorized);
                const head = stored.get('marketHead') as MarketHead;
                assert(head.collection === collection && head.shard === shard);
                if (head.recordStorage === 'parquet') return 0;

                const ids = head.retained;
                const refs = ids.flatMap(id => {
                    assert.equal(shardFor(id), shard);
                    return [db.doc(retainedPath('market_state', collection, id)),
                        db.doc(retainedPath('market_ugc', collection, id)), db.collection(collection).doc(id)];
                });
                const snapshots = refs.length ? await tx.getAll(...refs) : [];
                const rows = new Map((await files.read(head)).map(row => [row.id, row]));
                const movedRows = new Map<string, MarketRow>();
                for (let i = 0; i < ids.length; i++) {
                    const [state, ugc, legacy] = snapshots.slice(i * 3, i * 3 + 3);
                    assert(!legacy.exists && state.exists !== ugc.exists, 'Unexpected relationship source placement');
                    const source = state.exists ? state : ugc;
                    const prior = rows.get(source.id);
                    const published = prior ? (await files.hydrate(prior)).data : {};
                    const row = {id: source.id, data: {...published, ...source.data()}, version: source.updateTime!};
                    rows.set(row.id, row);
                    movedRows.set(row.id, row);
                }
                if (!apply) return movedRows.size;
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
                return movedRows.size;
            });
            console.log(JSON.stringify({shard, apply, moved}));
        }
    } finally {
        await files.close();
        await db.terminate();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
