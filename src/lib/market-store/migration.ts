import type { Firestore, Timestamp, DocumentSnapshot } from 'firebase-admin/firestore';
import { isDeepStrictEqual } from 'node:util';
import { CONTROL, headId } from './repository';
import {EVENTS_CONTROL} from './events-control';
import {FUNDAMENTALS_CONTROL} from './fundamentals-control';
import { MarketFiles, type MarketHead, type MarketRow } from './files';
import { splitRecord, retainsRecord, type MarketCollection } from './policy';
import { encodeMarket, decodeMarket } from './blobs';
import {compactHead,pointerCollection,pointerId} from './head-pointer';
/** An operator catch-up imports the authoritative source without touching it.
 * Native source + head reads ensure a concurrent application write either wins
 * before this import or causes the complete import transaction to retry. */
export async function reconcileMarketShard(raw: Firestore, files: MarketFiles, collection: MarketCollection, shard: string, ids: string[]) {
    return raw.runTransaction(async (tx) => {
        if ((await tx.get(raw.doc(collection==='events'?EVENTS_CONTROL:collection==='company_fundamentals'?FUNDAMENTALS_CONTROL:CONTROL))).get('ready') !== false)
            throw Error('Reconciliation requires bootstrap mode');
        const ref = raw.collection('collectors').doc(headId(collection, shard)), snapshot = await tx.get(ref);
        const head = snapshot.get('marketHead') as MarketHead | undefined;
        if (!head)
            throw Error('Initial shard inventory is incomplete');
        const rows = new Map((await files.read(head)).map(row => [row.id, row])), retained = new Set(head.retained);
        const docs = await tx.getAll(...ids.map(id => raw.collection(collection).doc(id)));
        for (const doc of docs) {
            if (!doc.exists) {
                rows.delete(doc.id);
                retained.delete(doc.id);
                continue;
            }
            const split = splitRecord(collection, doc.id, doc.data()!);
            const keep=retainsRecord(collection,doc.id,doc.data()!,split.retained);
            if (Object.keys(split.external).length || !keep)
                rows.set(doc.id, { id: doc.id, data: decodeMarket(await encodeMarket(split.external, files.bucket)), version: doc.updateTime! });
            else
                rows.delete(doc.id);
            if (keep)
                retained.add(doc.id);
            else
                retained.delete(doc.id);
        }
        const next = await files.write(collection, shard, [...rows.values()], [...retained]);
        tx.set(ref, { marketCollection: collection, marketHead: next });
        tx.set(raw.collection('collectors').doc(pointerId(collection,shard)),{marketCollection:pointerCollection(collection),marketHead:compactHead(next)});
        return docs.map(doc => ({ id: doc.id, version: doc.updateTime }));
    });
}
export function cleanupRecord(collection: MarketCollection, doc: DocumentSnapshot, archived: MarketRow | undefined) {
    if (!doc.exists)
        return { kind: 'absent' as const };
    const split = splitRecord(collection, doc.id, doc.data()!);
    const keep=retainsRecord(collection,doc.id,doc.data()!,split.retained);
    // Routing fields intentionally exist in both stores. A resumed cleanup must
    // recognize an already stripped live-state document without comparing its
    // routing-only projection against the full archived market payload again.
    if (keep&&isDeepStrictEqual(doc.data(),split.retained))
        return { kind: 'retained' as const };
    return { kind: keep ? 'strip' as const : 'delete' as const, external: split.external, retained: split.retained, archived };
}
/** Deletes only verified external fields. No UGC or live state is deleted, and
 * each transaction conflicts with concurrent source or Parquet-head changes. */
export async function cleanupMarketShard(raw: Firestore, files: MarketFiles, collection: MarketCollection, shard: string, ids: string[], cache: {
    file?: string;
    rows?: Map<string, MarketRow>;
} = {}) {
    return raw.runTransaction(async (tx) => {
        const control=await tx.get(raw.doc(collection==='events'?EVENTS_CONTROL:collection==='company_fundamentals'?FUNDAMENTALS_CONTROL:CONTROL));
        if (control.get('ready') !== true || control.get('cleanupAuthorized') !== true)
            throw Error('Cleanup requires verified cutover');
        const head = (await tx.get(raw.collection('collectors').doc(headId(collection, shard)))).get('marketHead') as MarketHead;
        if (!head)
            throw Error('Missing migrated shard');
        if (!cache.rows || cache.file !== head.file) {
            cache.rows = new Map((await files.read(head)).map(row => [row.id, row]));
            cache.file = head.file;
        }
        const docs = await tx.getAll(...ids.map(id => raw.collection(collection).doc(id))), writes: Array<() => void> = [];
        let deleted = 0, stripped = 0, retained = 0;
        // Blob verification is read-only and bounded by the operator's batch.
        // Verify every value before adding any transaction writes.
        const plans = await Promise.all(docs.map(async doc => {
            const plan = cleanupRecord(collection, doc, cache.rows!.get(doc.id));
            if (plan.kind !== 'absent' && plan.kind !== 'retained' && (!plan.archived || !isDeepStrictEqual(plan.external, (await files.hydrate(plan.archived)).data)))
                throw Error(`Cleanup parity mismatch: ${collection}/${doc.id}`);
            return {doc,plan};
        }));
        for (const {doc,plan} of plans) {
            if (plan.kind === 'absent')
                continue;
            if (plan.kind === 'retained') {
                retained++;
                continue;
            }
            if (plan.kind === 'delete') {
                writes.push(() => tx.delete(doc.ref));
                deleted++;
            }
            else {
                writes.push(() => tx.set(doc.ref, plan.retained));
                stripped++;
            }
        }
        for (const write of writes)
            write();
        return { deleted, stripped, retained };
    });
}
export const sameVersion = (a: Timestamp | undefined, b: Timestamp | undefined) => a === undefined ? b === undefined : b !== undefined && a.isEqual(b);
