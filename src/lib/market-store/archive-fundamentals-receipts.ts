import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Firestore} from 'firebase-admin/firestore';
import {MarketFiles, shardFor, type MarketHead, type MarketRow} from './files';
import {fundamentalsMode,FUNDAMENTALS_CONTROL} from './fundamentals-control';
import {retainedMode,RETAINED_CONTROL,retainedPath} from './retained-store';
import {archivedFundamentalsReceipt,fundamentalsReceiptId} from './policy';
import {headId} from './repository';
import {compactHead,pointerId,pointerCollection} from './head-pointer';

const collection='company_fundamentals';

/** The authoritative head and source documents participate in one transaction.
 * An upload or read-back failure leaves the previous head and receipts intact. */
export async function archiveReceiptBatch(db:Firestore, files:MarketFiles, shard:string, ids:string[]) {
    assert(/^[0-9a-f]{2}$/.test(shard));
    assert(ids.length>0 && ids.length<=100 && new Set(ids).size===ids.length);
    assert(ids.every(id=>fundamentalsReceiptId(id) && !id.includes('/') && shardFor(id)===shard));
    return db.runTransaction(async tx=>{
        const catalog=db.collection('collectors');
        const headRef=catalog.doc(headId(collection,shard));
        const [control,retention,snapshot]=await tx.getAll(db.doc(FUNDAMENTALS_CONTROL),db.doc(RETAINED_CONTROL),headRef);
        const mode=fundamentalsMode(control),retained=retainedMode(retention);
        assert(mode.ready && mode.cleanupAuthorized && mode.cleanedCollections.has(collection));
        assert(retained.ready && retained.cleanupAuthorized);
        const head=snapshot.get('marketHead') as MarketHead;
        assert(head.collection===collection && head.shard===shard && Array.isArray(head.retained));
        const members=new Set(head.retained);
        const batch=ids.filter(id=>members.has(id));
        if(!batch.length)return 0;
        const refs=batch.map(id=>db.doc(retainedPath('market_state',collection,id)));
        const docs=await tx.getAll(...refs);
        const finished=docs.filter(doc=>doc.exists && doc.get('completed')===true);
        if(!finished.length)return 0;
        const rows=new Map((await files.read(head)).map(row=>[row.id,row]));
        const archived=new Map<string,MarketRow>();
        for(const doc of finished){
            const previous=rows.get(doc.id);
            const external=previous?(await files.hydrate(previous)).data:{};
            const overlay=doc.data()!;
            for(const [key,value] of Object.entries(overlay))
                if(key in external && !isDeepStrictEqual(value,external[key]))throw Error('Conflicting receipt fields: '+doc.id);
            const data={...external,...overlay};
            if(!archivedFundamentalsReceipt(doc.id,data))continue;
            const row={id:doc.id,data,version:doc.updateTime!};
            rows.set(doc.id,row);archived.set(doc.id,row);members.delete(doc.id);
        }
        if(!archived.size)return 0;
        const siblings=await tx.getAll(...[...archived.keys()].map(id=>db.doc(retainedPath('market_ugc',collection,id))));
        if(siblings.some(doc=>doc.exists))throw Error('Receipt also exists in UGC');

        const next=await files.write(collection,shard,[...rows.values()],[...members]);
        const stored=new Map((await files.read(next)).map(row=>[row.id,row]));
        assert.equal(stored.size,rows.size);
        for(const [id,expected] of archived){
            const actual=await files.hydrate(stored.get(id)!);
            assert.deepEqual(actual.data,expected.data);
            assert(actual.version.isEqual(expected.version));
        }
        next.revision=randomUUID();
        tx.set(headRef,{marketCollection:collection,marketHead:next});
        tx.set(catalog.doc(pointerId(collection,shard)),{marketCollection:pointerCollection(collection),marketHead:compactHead(next)});
        for(const doc of finished)if(archived.has(doc.id))tx.delete(doc.ref);
        return archived.size;
    });
}
