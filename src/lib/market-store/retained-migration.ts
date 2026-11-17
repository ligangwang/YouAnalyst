import {isDeepStrictEqual} from 'node:util';
import type {Firestore} from 'firebase-admin/firestore';
import {RETAINED_CONTROL,retainedMode,retainedPath,retainedRoot,relocatesCollection} from './retained-store';
import type {MarketCollection} from './policy';

/** Reconcile after create-only bulk copying. The old record is authoritative
 * until the gate switches; concurrent application writes retry this transaction.
 * This also removes ghosts created when a source moved/deleted during copying. */
export async function reconcileRetainedRecords(raw:Firestore,collection:MarketCollection,ids:string[],verifyOnly=false){
    if(!relocatesCollection(collection)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw Error('Invalid retained migration batch');
    return raw.runTransaction(async tx=>{
        const mode=retainedMode(await tx.get(raw.doc(RETAINED_CONTROL)));
        if(!mode.enabled||mode.ready||mode.cleanupAuthorized)throw Error('Retained backfill requires the mirror phase');
        const sources=await tx.getAll(...ids.map(id=>raw.collection(collection).doc(id)));
        const refs=ids.flatMap(id=>(['market_state','market_ugc'] as const).map(root=>raw.doc(retainedPath(root,collection,id))));
        const copies=await tx.getAll(...refs);
        let changed=0;
        for(let n=0;n<ids.length;n++){
            const source=sources[n],data=source.data(),root=source.exists?retainedRoot(collection,source.id,data!):undefined;
            for(const [offset,candidate] of (['market_state','market_ugc'] as const).entries()){
                const index=n*2+offset,doc=copies[index];
                if(candidate===root){
                    if(!doc.exists||!isDeepStrictEqual(doc.data(),data)){
                        changed++;if(!verifyOnly)tx.set(refs[index],data!);
                    }
                }else if(doc.exists){changed++;if(!verifyOnly)tx.delete(refs[index]);}
            }
        }
        if(verifyOnly&&changed)throw Error('Retained-state parity failed');
        return {checked:ids.length,changed};
    });
}
