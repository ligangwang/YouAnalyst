import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import type {Firestore} from 'firebase-admin/firestore';
import {RETAINED_CONTROL,retainedMode,retainedPath,retainedRoot,relocatesCollection} from '../../src/lib/market-store/retained-store';
/** Compare a bounded page at one read time. Only mismatches need write transactions. */
export async function auditRetainedPage(raw:Firestore,collection:string,ids:string[]):Promise<string[]> {
    assert(relocatesCollection(collection)&&ids.length>0&&ids.length<=1000&&new Set(ids).size===ids.length,'Invalid retained audit page');
    return raw.runTransaction(async tx=>{
        const mode=retainedMode(await tx.get(raw.doc(RETAINED_CONTROL)));
        assert(mode.enabled&&!mode.ready&&!mode.cleanupAuthorized,'Retained audit requires the mirror phase');
        const refs=ids.flatMap(id=>[raw.collection(collection).doc(id),raw.doc(retainedPath('market_state',collection,id)),raw.doc(retainedPath('market_ugc',collection,id))]);
        const snapshots=await tx.getAll(...refs),byPath=new Map(snapshots.map(doc=>[doc.ref.path,doc]));
        assert.equal(byPath.size,refs.length,'Incomplete retained audit snapshot');
        return ids.filter((id,n)=>{
            const source=byPath.get(refs[n*3].path)!,data=source.data();
            const root=source.exists?retainedRoot(collection,id,data!):undefined;
            return (['market_state','market_ugc'] as const).some((candidate,offset)=>{
                const copy=byPath.get(refs[n*3+offset+1].path)!;
                return candidate===root?!copy.exists||!isDeepStrictEqual(copy.data(),data):copy.exists;
            });
        });
    },{readOnly:true});
}
