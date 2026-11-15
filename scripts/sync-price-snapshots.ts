import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore as rawFirestore} from 'firebase-admin/firestore';
import {PriceStore} from '../src/lib/price-store/storage';
import {catchUpPrices,compactPrices} from '../src/lib/price-store/migration';
import {getStorage} from 'firebase-admin/storage';
import {getFirestore} from '../src/lib/firebase/firestore';
import {snapshotSource} from '../src/lib/entity-snapshots/firestore-source';
import {syncPricePartitions,priceSyncOptions} from '../src/lib/entity-snapshots/price-sync';

async function main(){
 const projectId=process.env.GCP_PROJECT_ID,bucketName=process.env.ENTITY_SNAPSHOT_BUCKET;
 if(!projectId||!bucketName)throw Error('GCP_PROJECT_ID and ENTITY_SNAPSHOT_BUCKET are required');
 if(process.env.PRICE_TIMESTAMP_MIGRATION_COMPLETE!=='1')throw Error('Verify price timestamp migration before enabling sync');
 if(process.argv.length>2)throw Error('sync-price-snapshots takes configuration from environment variables');
 const options=priceSyncOptions();
 initializeApp({credential:applicationDefault(),projectId});
 if(['shadow','parquet-read','parquet'].includes(process.env.PRICE_STORAGE??'')){
  const store=new PriceStore(getStorage().bucket(bucketName));
  try{
   if(process.env.PRICE_STORAGE!=='parquet')console.info(JSON.stringify({event:'price_parquet_catchup',...await catchUpPrices(rawFirestore(),store,options.maxReads)}));
   console.info(JSON.stringify({event:'price_parquet_compaction',...await compactPrices(store)}));
  }finally{await store.close();}
  return;
 }
 console.info(JSON.stringify({event:'price_sync_started',job:process.env.CLOUD_RUN_JOB,execution:process.env.CLOUD_RUN_EXECUTION,...options}));
 const result=await syncPricePartitions(snapshotSource(getFirestore()),getStorage().bucket(bucketName),options);
 console.info(JSON.stringify({event:'price_partition_sync',job:process.env.CLOUD_RUN_JOB,execution:process.env.CLOUD_RUN_EXECUTION,...result}));
}
main().catch(error=>{console.error(JSON.stringify({severity:'ERROR',event:'price_sync_failed',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;});
