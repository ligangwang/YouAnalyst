import {FieldPath,FieldValue,type Firestore,type QueryDocumentSnapshot} from 'firebase-admin/firestore';
import {secCollectorMetadata,secCollectorFreshness} from './store';
import {secDiscoveryCompanyState} from '../sec-collector-state';

const ID=/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/;
const INVENTORY='discoveryCompanyIds';
export type DiscoveryCompletion={discoveryStatus:'complete'|'partial';discoveryNextPollAtMs:number;discoveryCompleteAt?:string};
/** Existing collector metadata stores only registration IDs, never a status copy.
 * Seed a bounded slice so absent documents become queryable without point reads
 * of every existing company. Atomic inventory + merge preserves all cursors. */
export async function registerSecDiscoveryCompanies(db:Firestore,ids:readonly string[],limit:number){
 const scope=[...new Set(ids)].sort();
 if(scope.some(id=>!ID.test(id))||!Number.isSafeInteger(limit)||limit<1||limit>250)throw Error('Invalid discovery registration scope');
 if(Buffer.byteLength(JSON.stringify(scope))>700_000)throw Error('SEC discovery registration inventory exceeds safe document size');
 const meta=secCollectorMetadata(db);
 return db.runTransaction(async tx=>{
  const data=(await tx.get(meta)).data(),saved=data?.[INVENTORY]??[];
  if(!Array.isArray(saved)||saved.some(id=>typeof id!=='string'||!ID.test(id)))throw Error('Invalid discovery inventory');
  const active=new Set(scope),known=new Set<string>(saved);
  const removed=[...known].filter(id=>!active.has(id)).slice(0,200);
  const added=scope.filter(id=>!known.has(id)).slice(0,Math.min(limit,400-removed.length));
  for(const id of removed){
   tx.set(secDiscoveryCompanyState(db,id.slice(3)),{discoveryStatus:'disabled',discoveryNextPollAtMs:FieldValue.delete(),discoveryCompleteAt:FieldValue.delete()},{merge:true});known.delete(id);
  }
  for(const id of added){
   tx.set(secDiscoveryCompanyState(db,id.slice(3)),{discoveryStatus:'pending',discoveryNextPollAtMs:0},{merge:true});known.add(id);
  }
  if(added.length||removed.length)tx.set(meta,{[INVENTORY]:[...known].sort()},{merge:true});
  return {registered:added.length,unregistered:scope.filter(id=>!known.has(id)).length,removalsPending:[...known].some(id=>!active.has(id))};
 });
}

/** A single due index includes new work, incomplete retries and completed polls.
 * Each failed attempt moves its retry time forward, allowing older work to run. */
export async function selectSecDiscoveryCompanies(db:Firestore,ids:readonly string[],options:{now:number;maxCompanies:number}){
 const {now,maxCompanies}=options;
 if(!Number.isFinite(now)||!Number.isSafeInteger(maxCompanies)||maxCompanies<1||maxCompanies>500)throw Error('Invalid discovery selection bounds');
 const registration=await registerSecDiscoveryCompanies(db,ids,Math.max(1,Math.floor(maxCompanies/2)));
 const scope=new Set(ids),selected:string[]=[];let cursor:QueryDocumentSnapshot|undefined,read=0;
 const base=db.collection('sec_collector_state').where('discoveryNextPollAtMs','<=',now)
  .orderBy('discoveryNextPollAtMs').orderBy(FieldPath.documentId());
 while(selected.length<maxCompanies&&read<1000){
  const limit=Math.min(250,maxCompanies-selected.length,1000-read);
  const page=await(cursor?base.startAfter(cursor):base).limit(limit).get();
  read+=page.size;
  for(const doc of page.docs){
   const id=doc.id.startsWith('_discovery_')?'US:'+doc.id.slice('_discovery_'.length):'';
   if(scope.has(id)&&Number(doc.get('leaseExpiresAtMs')??0)<=now)selected.push(id);
   else if(ID.test(id)&&!scope.has(id)&&Number(doc.get('leaseExpiresAtMs')??0)<=now){
    // A task finishing after removal may restore its summary. Retire it once
    // its lease ends so it cannot pollute due queries or incomplete counts.
    await db.collection('sec_collector_state').doc(doc.id).set({discoveryStatus:'disabled',discoveryNextPollAtMs:FieldValue.delete(),discoveryCompleteAt:FieldValue.delete()},{merge:true});
   }
  }
  if(page.size<limit)break;
  cursor=page.docs.at(-1);
 }
 // These indexed checks replace three point reads for every company. Incomplete
 // counts include queued/pending work; accepted tasks never imply freshness.
 const [pending,oldest]=await Promise.all([
  db.collection('sec_collector_state').where('discoveryStatus','in',['pending','partial']).count().get(),
  db.collection('sec_collector_state').orderBy('discoveryCompleteAt').limit(1).get(),
 ]);
 const incomplete=registration.unregistered+pending.data().count+(registration.removalsPending?1:0);
 const completedAt=oldest.docs[0]?.get('discoveryCompleteAt');
 const oldestTime=Date.parse(String(completedAt));
 const validOldest=Number.isFinite(oldestTime)&&oldestTime<=now;
 const remaining=Math.max(incomplete,!ids.length||!validOldest?1:0);
 const freshness={companies:ids.length,failed:0,partial:remaining,remaining,outboxIncomplete:false};
 await secCollectorFreshness(db).set({lastRunAt:validOldest?new Date(oldestTime).toISOString():new Date(0).toISOString(),result:freshness},{merge:true});
 return {ids:selected,freshness,statusDocumentsRead:read,registered:registration.registered,unregistered:registration.unregistered};
}
