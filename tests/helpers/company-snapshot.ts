import {Firestore,Timestamp,type DocumentData} from 'firebase-admin/firestore';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory} from '../../src/lib/local-cache/company-directory';
import {EntitySync,type ChangeBatch,type EntityChange} from '../../src/lib/local-cache/entity-sync';
import type {EntityRows} from '../../src/lib/entity-snapshots/sqlite';

export function companySnapshotFixture(records:Map<string,DocumentData>,initialChanges:EntityChange[]=[]){
 const sdk=new Firestore({projectId:'company-snapshot-test'}),db=observeFirestore(sdk,()=>{});
 const watermark=new Timestamp(100,0),boundaries:Timestamp[]=[];
 let loads=0,reads=0,next!:(batch:ChangeBatch)=>void,sync!:EntitySync;
 const raw={collection:()=>{reads++;throw Error('Unexpected full Firestore read');}} as unknown as Firestore;
 enableCompanyDirectory(db,raw,{file:async()=>{loads++;return Object.assign(new Map(records),{watermark}) as EntityRows;},
  sync:(_db,collection,since,apply)=>{
   if(collection!=='companies')throw Error('Unexpected collection');boundaries.push(since);
   return sync=new EntitySync((_since,callback)=>{next=callback;queueMicrotask(()=>callback({readTime:new Timestamp(101,0),changes:initialChanges}));return()=>{};},since,apply);
  }});
 return {db,watermark,boundaries,get loads(){return loads;},get reads(){return reads;},
  change:(changes:EntityChange[])=>next({readTime:new Timestamp(102,0),changes}),close:()=>sync?.close()};
}
