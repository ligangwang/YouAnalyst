import assert from 'node:assert/strict';
import {validFundamentalsTicker,usFundamentalsId,usFundamentalsTicker} from '../fundamentals/identity';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Firestore} from 'firebase-admin/firestore';
import {MarketFiles, shardFor, type MarketHead, type MarketRow} from './files';
import {fundamentalsMode,FUNDAMENTALS_CONTROL} from './fundamentals-control';
import {retainedMode,RETAINED_CONTROL,retainedPath} from './retained-store';
import {archivedFundamentalsReceipt,fundamentalsReceiptId,settledUsFundamentals} from './policy';
import {headId} from './repository';
import {compactHead,pointerId,pointerCollection} from './head-pointer';

const collection='company_fundamentals';
type ArchiveKind='receipt'|'retired-ticker'|'settled-us';
const retiredStatusFields=new Set(['lastError','outcome','requestedAt','dispatchAfter','dispatchOwner','lastAttemptAt','refreshAfter','pending','updatedAt','lastFilingRefresh']);
function retiredStatus(data:Record<string,unknown>,now:number){
    return data.pending===false && (data.outcome==='ready'||data.outcome==='unavailable')
        && (data.dispatchAfter==null || typeof data.dispatchAfter==='number'&&data.dispatchAfter<=now)
        && Object.keys(data).every(field=>retiredStatusFields.has(field));
}

/** The authoritative head and source documents participate in one transaction.
 * An upload or read-back failure leaves the previous head and receipts intact. */
export async function archiveReceiptBatch(db:Firestore, files:MarketFiles, shard:string, ids:string[],kind:ArchiveKind='receipt') {
    assert(/^[0-9a-f]{2}$/.test(shard));
    assert(ids.length>0 && ids.length<=100 && new Set(ids).size===ids.length);
    const legacy=kind==='retired-ticker';
    const receipt=kind==='receipt';
    assert(ids.every(id=>(receipt?fundamentalsReceiptId(id):legacy?validFundamentalsTicker(id):usFundamentalsTicker(id)!==null) && !id.includes('/') && shardFor(id)===shard));
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
        const finished=docs.filter(doc=>doc.exists && (receipt?doc.get('completed')===true:legacy?retiredStatus(doc.data()!,doc.readTime.toMillis()):settledUsFundamentals(doc.id,doc.data()!,doc.readTime.toMillis())));
        if(!finished.length)return 0;
        // Require a current worker record at its market-qualified key. Its state
        // may have advanced independently since the two keys were split.
        const canonical=!legacy?[]:await tx.getAll(...finished.map(doc=>db.doc(retainedPath('market_state',collection,usFundamentalsId(doc.id)))));
        const currentIds=new Set(canonical.filter(doc=>doc.exists).map(doc=>doc.id));
        const rows=new Map((await files.read(head)).map(row=>[row.id,row]));
        const archived=new Map<string,MarketRow>();
        for(const doc of finished){
            if(legacy&&!currentIds.has(usFundamentalsId(doc.id)))continue;
            const previous=rows.get(doc.id);
            const external=previous?(await files.hydrate(previous)).data:{};
            const overlay=doc.data()!;
            for(const [key,value] of Object.entries(overlay))
                if(key in external && !isDeepStrictEqual(value,external[key]))throw Error('Conflicting receipt fields: '+doc.id);
            const data={...external,...overlay};
            if(kind==='settled-us'&&!settledUsFundamentals(doc.id,data,doc.readTime.toMillis()))continue;
            if(receipt&&!archivedFundamentalsReceipt(doc.id,data))continue;
            if(legacy&&Object.keys(external).some(key=>!['marketCap','cnAnnual','isDeleted','version','value','updatedAt','unavailableReason'].includes(key)))continue;
            const row={id:doc.id,data,version:doc.updateTime!};
            rows.set(doc.id,row);archived.set(doc.id,row);members.delete(doc.id);
        }
        if(!archived.size)return 0;
        const siblings=await tx.getAll(...[...archived.keys()].flatMap(id=>[db.doc(retainedPath('market_ugc',collection,id)), db.doc(collection+'/'+id)]));
        if(siblings.some(doc=>doc.exists))throw Error('Archive target also exists in the root collection or UGC');

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
