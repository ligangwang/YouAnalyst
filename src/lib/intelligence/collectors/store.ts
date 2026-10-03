import type {Firestore} from 'firebase-admin/firestore';
import type {NewsSource} from './sources';
import type {NewsResponse} from './news';
import type {CollectedNews,NewsCursor,NewsStore} from './collector';

export const NEWS_EVENTS_COLLECTION='intelligence_events';
export const NEWS_COLLECTORS_COLLECTION='intelligence_collectors';
/** Collection creation requires the exact-name approval specified in AGENTS.md. */
export function firestoreNewsStore(db:Firestore):NewsStore{
  const metadata=(source:NewsSource)=>db.collection(NEWS_COLLECTORS_COLLECTION).doc(source.id);
  return {
    acquire:(source,at,leaseId)=>db.runTransaction(async tx=>{
      const ref=metadata(source),stored=(await tx.get(ref)).data() as NewsCursor|undefined;
      if(stored&&(Date.parse(stored.nextPollAt)>at.getTime()||Date.parse(stored.leaseUntil)>at.getTime()))return null;
      const cursor:NewsCursor={version:1,sourceId:source.id,baselineAt:stored?.baselineAt??null,lastSuccessAt:stored?.lastSuccessAt??null,nextPollAt:stored?.nextPollAt??at.toISOString(),failures:stored?.failures??0,validators:stored?.validators??{},itemIds:stored?.itemIds??[],leaseId,leaseUntil:new Date(at.getTime()+120_000).toISOString(),lastError:stored?.lastError??null,partial:stored?.partial??false};
      tx.set(ref,cursor);return cursor;
    }),
    commit:(source,cursor,response:NewsResponse,at)=>db.runTransaction(async tx=>{
      const ref=metadata(source),state=(await tx.get(ref)).data() as NewsCursor|undefined;
      if(state?.leaseId!==cursor.leaseId||Date.parse(state.leaseUntil)<at.getTime())throw new Error('Collector lease expired');
      const baseline=!state.baselineAt,known=new Set(state.itemIds);
      const items=response.status==='modified'?response.page.items:[];
      const candidates=items.filter(item=>!known.has(item.id));
      const refs=candidates.map(item=>db.collection(NEWS_EVENTS_COLLECTION).doc(item.id));
      const existing=refs.length?await tx.getAll(...refs):[];
      let created=0;
      candidates.forEach((item,index)=>{
        if(existing[index].exists)return;
        const event:CollectedNews={...item,version:1,firstObservedAt:at.toISOString(),baseline};
        tx.create(refs[index],event);created++;
      });
      tx.set(ref,{...state,baselineAt:state.baselineAt??at.toISOString(),lastSuccessAt:at.toISOString(),nextPollAt:new Date(at.getTime()+source.pollMs).toISOString(),failures:0,lastError:null,leaseId:'',leaseUntil:at.toISOString(),validators:response.status==='modified'?response.validators:state.validators,itemIds:response.status==='modified'?items.map(item=>item.id):state.itemIds,partial:response.status==='modified'?(response.page.invalid>0||response.page.truncated):state.partial});
      return {created,baseline};
    }),
    fail:(source,cursor,error,retryAt)=>db.runTransaction(async tx=>{
      const ref=metadata(source),state=(await tx.get(ref)).data() as NewsCursor|undefined;
      if(state?.leaseId!==cursor.leaseId)return;
      tx.set(ref,{...state,failures:state.failures+1,lastError:error.slice(0,300),nextPollAt:retryAt.toISOString(),leaseId:'',leaseUntil:new Date(0).toISOString()});
    }),
  };
}
