import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getStorage} from 'firebase-admin/storage';
import {PriceStore} from '../src/lib/price-store/storage';
import {compactPrices} from '../src/lib/price-store/migration';
async function main(){
 const projectId=process.env.GCP_PROJECT_ID,bucketName=process.env.ENTITY_SNAPSHOT_BUCKET;
 if(!projectId||!bucketName)throw Error('GCP_PROJECT_ID and ENTITY_SNAPSHOT_BUCKET are required');
 if(process.argv.length>2)throw Error('sync-price-snapshots takes configuration from environment variables');
 initializeApp({credential:applicationDefault(),projectId});
 const store=new PriceStore(getStorage().bucket(bucketName));
 try{console.info(JSON.stringify({event:'price_parquet_compaction',...await compactPrices(store),firestoreReads:0,firestoreWrites:0}));}
 finally{await store.close();}
}
main().catch(error=>{console.error(JSON.stringify({severity:'ERROR',event:'price_sync_failed',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;});
