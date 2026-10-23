import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { setTimeout as delay } from 'node:timers/promises';
import {authenticatedMigrationRequest,createWebsiteMigrationGuard,discoverCacheSubscriptions} from './firestore/website-migration-guard';

// Run after all legacy writers have drained. Dry-run by default; bounded pages
// and batches, optimistic preconditions, and periodic production monitoring.
// Raw SDK intentionally bypasses the application timestamp wrapper so the old
// field can be deleted. Normal Firestore change triggers still apply.
async function main() {
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--apply'&&!/^--(collection|after|limit|compatible-revision)=/.test(arg)))throw Error('Unknown argument');
  const collection=args.find(arg=>arg.startsWith('--collection='))?.slice(13);
  if(!collection||!['companies','instruments','company_fundamentals','company_relationships','eod_prices','collectors'].includes(collection))throw Error('--collection is required');
  if(!process.env.GCP_PROJECT_ID)throw Error('GCP_PROJECT_ID is required');
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  const db=getFirestore(),apply=args.includes('--apply');
  const limit=Number(args.find(arg=>arg.startsWith('--limit='))?.slice(8)??100);
  if(!Number.isInteger(limit)||limit<1||limit>3000)throw Error('Invalid page limit');
  const revision=args.find(arg=>arg.startsWith('--compatible-revision='))?.slice(22);
  const auth=authenticatedMigrationRequest();
  const request:typeof auth=(url,init)=>auth(url,{...init,headers:{...init?.headers,'x-goog-user-project':process.env.GCP_PROJECT_ID!}});
  const health=async()=>{const r=await fetch('https://youanalyst.com/api/health',{signal:AbortSignal.timeout(30000),cache:'no-store'});if(!r.ok)throw Error('Website health failed');const h=await r.json();if(h.status!=='ok'||h.revision!==revision)throw Error('Compatible website revision required');};
  const guard=apply?createWebsiteMigrationGuard({project:process.env.GCP_PROJECT_ID,startedAt:new Date(Date.now()-60000).toISOString(),subscriptions:await discoverCacheSubscriptions(process.env.GCP_PROJECT_ID,'us-central1',request),request}):undefined;
  if(apply){if(!revision)throw Error('--compatible-revision required');await health();await guard!();}
  let lastCheck=Date.now();
  let after=args.find(arg=>arg.startsWith('--after='))?.slice(8)??'';
  let query=db.collection(collection).orderBy(FieldPath.documentId()).limit(limit);
  if(after)query=query.startAfter(after);
  const page=await query.get();let changed=0;
  const pending:typeof page.docs=[];
  for(const doc of page.docs){
    const data=doc.data();
    const eligible=collection==='collectors'?!!data.cacheDeletedCollection:!doc.id.startsWith('_');
    if(eligible&&(!(data.updatedAt instanceof Timestamp)||Object.hasOwn(data,'cacheUpdatedAt'))){
      if(apply)pending.push(doc);
      changed++;
    }
    after=doc.id;
  }
  for(let i=0;i<pending.length;i+=50){
    if(Date.now()-lastCheck>=60000){await health();await guard!();lastCheck=Date.now();}
    const batch=db.batch();
    for(const doc of pending.slice(i,i+50)){const data=doc.data();
        // Preconditions prevent overwriting a concurrently changed record.
        batch.update(doc.ref,{updatedAt:FieldValue.serverTimestamp(),cacheUpdatedAt:FieldValue.delete(),
          ...(data.isDeleted===true&&!data.deletedAt&&data.updatedAt instanceof Timestamp?{deletedAt:data.updatedAt}:{}),
        },{lastUpdateTime:doc.updateTime});
    }
    await batch.commit();await delay(1000);
  }
  if(apply){await health();await guard!();}
  console.log(JSON.stringify({collection,apply,scanned:page.size,changed,after,complete:page.size<limit}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
