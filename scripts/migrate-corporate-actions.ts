// Operator-only additive migration. This script NEVER deletes source documents.
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore,FieldPath} from 'firebase-admin/firestore';
import {Storage} from '@google-cloud/storage';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ActionStore,ACTION_ROOT,actionShard} from '../src/lib/action-store/storage';
import {encode} from '../src/lib/central-cache/codec';
import {actionBucketName} from '../src/lib/action-store/config';
import type {Row} from '../src/lib/entity-snapshots/sync';

async function main(){
 const project=process.env.GOOGLE_CLOUD_PROJECT,bucketName=actionBucketName();
 if(project!=='ifindata-80905'||!bucketName)throw Error('Explicit production project and bucket required');
 initializeApp({credential:applicationDefault(),projectId:project});const db=getFirestore();
 const bucket=new Storage({projectId:project}).bucket(bucketName),store=new ActionStore(bucket);
 const groups=new Map<string,Row[]>();let cursor:string|undefined,total=0;
 const startedAt=new Date().toISOString();
 try{
  for(;;){let query=db.collection('corporate_actions').orderBy(FieldPath.documentId()).limit(500);if(cursor)query=query.startAfter(cursor);
   const page=await query.get();for(const doc of page.docs){const row={id:doc.id,data:doc.data()},shard=actionShard(String(row.data.ticker));
    const rows=groups.get(shard)??[];rows.push(row);groups.set(shard,rows);total++;
   }if(page.size<500)break;cursor=page.docs.at(-1)!.id;
   if(total%10000===0)console.info(JSON.stringify({event:'action_export_progress',rows:total}));
  }
  const run=startedAt.replaceAll(':','-'),backup=`${ACTION_ROOT}/operator/${run}/source.json`;
  await bucket.file(backup).save(JSON.stringify(encode([...groups.values()].flat())),{resumable:true,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/json'}});
  const hash=createHash('sha256');let checked=0,newer=0,parquetRows=0;
  for(let n=0;n<256;n++){
   const shard=n.toString(16).padStart(2,'0'),source=groups.get(shard)??[];
   if(process.env.VERIFY_ONLY!=='1')await store.importShard(shard,source);
   const stored=await store.readShard(shard),byId=new Map(stored.map(r=>[r.id,r]));parquetRows+=stored.length;
   for(const row of source){const found=byId.get(row.id);if(!found)throw Error(`Missing migrated action ${row.id}`);
    if(!isDeepStrictEqual(found,row)){
     if(Date.parse(found.data.updatedAt)>Date.parse(row.data.updatedAt))newer++;
     else throw Error(`Action field parity failed ${row.id}`);
    }hash.update(row.id+'\n');checked++;
   }
   if(n%32===31)console.info(JSON.stringify({event:'action_parity_progress',shards:n+1,checked,newer}));
  }
  const count=(await db.collection('corporate_actions').count().get()).data().count;
  if(count!==total)throw Error('Source changed during migration: rerun reconciliation');
  if(!total||checked!==total||parquetRows<total)throw Error('Incomplete action migration');
  const audit={startedAt,completedAt:new Date().toISOString(),sourceRows:total,sourceCountAfter:count,parquetRows,checked,newer,sourceIdSha256:hash.digest('hex'),backup,firestoreWrites:0};
  await bucket.file(`${ACTION_ROOT}/operator/${run}/audit.json`).save(JSON.stringify(audit),{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/json'}});
  // Readiness is a separate operator step AFTER every old writer has drained.
  // New writers stage Parquet before updating Firestore throughout this copy.
  // A cached bootstrap writer finishing after publication is therefore safe.
  console.info(JSON.stringify({event:'action_migration_verified',...audit}));
 }finally{await store.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
