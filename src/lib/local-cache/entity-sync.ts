import {Timestamp,type Firestore,type DocumentData} from 'firebase-admin/firestore';
import type {Collection} from '../entity-snapshots/sync';
export type EntityChange={id:string;data:DocumentData};
export type ChangeBatch={changes:EntityChange[];readTime:Timestamp};
export type Subscribe=(since:Timestamp,next:(batch:ChangeBatch)=>void,error:(error:Error)=>void)=>()=>void;
const later=(a:Timestamp,b:Timestamp)=>a.seconds>b.seconds||a.seconds===b.seconds&&a.nanoseconds>b.nanoseconds;
/** Initial snapshot is the catch-up. Later snapshots carry changed IDs and values.
 * Advance the resume boundary only after the whole batch has been applied. */
export class EntitySync {
 private checkpoint:Timestamp;
 private unsubscribe?:()=>void;
 private retry?:ReturnType<typeof setTimeout>;
 private stopped=false;
 private generation=0;
 private initial!:Promise<void>;
 constructor(private subscribe:Subscribe,since:Timestamp,private apply:(changes:EntityChange[])=>void,private retryMs=5000){this.checkpoint=since;this.connect();}
 private connect(){
  if(this.stopped)return;
  const generation=++this.generation;
  this.initial=new Promise<void>((resolve,reject)=>{
   const fail=(error:Error)=>{
    if(this.stopped||generation!==this.generation)return;
    ++this.generation;this.unsubscribe?.();this.unsubscribe=undefined;
    reject(error);console.warn('entity_snapshot_listener_failed',error.message);
    this.retry=setTimeout(()=>this.connect(),this.retryMs);this.retry.unref();
   };
   try{
    const unsubscribe=this.subscribe(this.checkpoint,batch=>{
     if(this.stopped||generation!==this.generation)return;
     try{
      this.apply(batch.changes);
      if(later(batch.readTime,this.checkpoint))this.checkpoint=batch.readTime;
      resolve();
     }catch(error){fail(error instanceof Error?error:new Error(String(error)));}
    },fail);
    if(generation===this.generation)this.unsubscribe=unsubscribe;else unsubscribe();
   }catch(error){fail(error instanceof Error?error:new Error(String(error)));}
  });
  void this.initial.catch(()=>undefined);
 }
 ready(){return this.initial;}
 close(){this.stopped=true;++this.generation;clearTimeout(this.retry);this.unsubscribe?.();active.delete(this);}
}
declare global {var __entitySnapshotSyncs:Set<EntitySync>|undefined;}
const active=globalThis.__entitySnapshotSyncs??=new Set<EntitySync>();
export function closeEntitySyncs(){for(const sync of active)sync.close();}
export function syncEntityChanges(db:Firestore,collection:Collection,since:Timestamp,apply:(changes:EntityChange[])=>void){
 const sync=new EntitySync((watermark,next,error)=>db.collection(collection).where('updatedAt','>=',watermark).orderBy('updatedAt').onSnapshot(snapshot=>{
  next({readTime:snapshot.readTime,changes:snapshot.docChanges().map(change=>({id:change.doc.id,
   data:change.type==='removed'?{isDeleted:true,updatedAt:snapshot.readTime}:change.doc.data()}))});
 },error),since,apply);
 active.add(sync);return sync;
}
