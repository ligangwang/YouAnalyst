import type { Firestore } from 'firebase-admin/firestore';
import { changeCached, readCacheState, withCacheReadScope, type CacheCollection } from '../../change-cache';

/** Track only the sources used by this view. Old receivers retain safe collection-level invalidation. */
export function loadNewsCollectorStatuses(db:Firestore, ids:string[]) {
 return withCacheReadScope(async()=>{
  if(!ids.length)return [];
  const state=await readCacheState(db);
  const tracked=state.collectorGeneration && state.collectorDocumentsVersion===state.versions?.collectors;
  const dependencies:(CacheCollection|`collector:${string}`)[]=tracked
   ? [...new Set(ids)].sort().map(id=>`collector:${id}` as const) : ['collectors'];
  return changeCached(db,`news-status:${tracked?state.collectorGeneration:"legacy"}:${JSON.stringify(ids)}`,dependencies,
   ()=>db.getAll(...ids.map(id=>db.collection('collectors').doc(id))));
 });
}
