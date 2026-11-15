import type {Firestore} from 'firebase-admin/firestore';
import {ActionStore,mergeActionFields,type ActionRepository} from './storage';
/** Temporary rolling-deploy bridge. The explicitly provisioned ready:false
 * marker retains Firestore reads. New writes reach Parquet BEFORE Firestore,
 * so after old writers drain a final reconciliation can safely publish ready.
 * Missing/corrupt markers fail closed; they never enable a fallback. */
export function bootstrapActions(db:Firestore,store:ActionStore):ActionRepository{
 const source=async(ticker:string)=>(await db.collection('corporate_actions').where('ticker','==',ticker).get()).docs.map(doc=>({id:doc.id,data:doc.data()}));
 return {
  readTicker:async ticker=>await store.isReady()?store.readTicker(ticker):source(ticker),
  mergeTicker:async(ticker,rows)=>{
   if(await store.isReady()){await store.mergeTicker(ticker,rows);return;}
   if(!rows.length)return;
   const previous=new Map((await source(ticker)).map(row=>[row.id,row.data]));
   const full=rows.map(row=>({id:row.id,data:mergeActionFields(previous.get(row.id)??{},row.data)}));
   await store.stageTicker(ticker,full);
   for(let offset=0;offset<rows.length;offset+=400){const batch=db.batch();
    for(const row of rows.slice(offset,offset+400))batch.set(db.collection('corporate_actions').doc(row.id),row.data,{merge:true});
    await batch.commit();
   }
  },
 };
}
