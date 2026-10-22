import type { DocumentReference, DocumentSnapshot, Firestore, Query, QuerySnapshot } from 'firebase-admin/firestore';
import { collectionSourceSnapshot, withSourceCache } from './local-cache/read-scope';

// Website clients resolve these lookups from the shared file-backed directory.
// Legacy/test clients retain their source subscription behavior.
export function readCompanyLookup(db: Firestore, source: DocumentReference): Promise<DocumentSnapshot>;
export function readCompanyLookup(db: Firestore, source: Query): Promise<QuerySnapshot>;
export function readCompanyLookup(db: Firestore, source: DocumentReference | Query): Promise<DocumentSnapshot | QuerySnapshot> {
  return withSourceCache(async () => {
    const snapshot=await (collectionSourceSnapshot(db, source, 'companies') ?? source.get());
    if('docs' in snapshot){
      const docs=snapshot.docs.filter((doc:DocumentSnapshot)=>doc.data()?.isDeleted!==true);
      return new Proxy(snapshot,{get(target,key){
        if(key==='docs')return docs;
        if(key==='size')return docs.length;
        if(key==='empty')return docs.length===0;
        if(key==='forEach')return (fn:(doc:DocumentSnapshot)=>void)=>docs.forEach(fn);
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
    }
    if(snapshot.data()?.isDeleted!==true)return snapshot;
    return new Proxy(snapshot,{get(target,key){
      if(key==='exists')return false;
      if(key==='data'||key==='get')return ()=>undefined;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  });
}
