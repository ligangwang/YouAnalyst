import {FieldPath,type Firestore,type DocumentSnapshot} from 'firebase-admin/firestore';
import { withCacheReadScope } from '../../change-cache';
import {collectionSourceSnapshot} from '../../local-cache/read-scope';
/** Subscribe only to source-status documents used by this view. */
export function loadNewsCollectorStatuses(db: Firestore, ids: string[]) {
  return withCacheReadScope(async () => {
    const keys=[...new Set(ids.map(id=>`news-health-${id}`))].sort();
    const found=new Map<string,DocumentSnapshot>();
    const batches=[];
    for(let i=0;i<keys.length;i+=30)batches.push(keys.slice(i,i+30));
    await Promise.all(batches.map(async batch=>{
      const query=db.collection('collectors').where(FieldPath.documentId(),'in',batch);
      const page=await(collectionSourceSnapshot(db,query,'collectors')??query.get());
      for(const doc of page.docs)found.set(doc.id,doc);
    }));
    // Preserve caller order and missing-status semantics without individual
    // missing-document reads. Push snapshots include additions and withdrawals.
    return ids.map(id=>found.get(`news-health-${id}`)??{data:()=>undefined});
  });
}
