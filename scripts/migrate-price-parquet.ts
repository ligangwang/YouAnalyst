import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {PriceStore,readHead} from '../src/lib/price-store/storage';
import {exportPrices,catchUpPrices,compactPrices} from '../src/lib/price-store/migration';

async function main(){
 const projectId=process.env.GCP_PROJECT_ID,bucketName=process.env.ENTITY_SNAPSHOT_BUCKET;
 if(!projectId||!bucketName)throw Error('Project and snapshot bucket required');
 const mode=process.env.PRICE_MIGRATION_MODE??'export';
 if(!['export','catchup','compact','inspect'].includes(mode))throw Error('Invalid migration mode');
 initializeApp({credential:applicationDefault(),projectId});
 const store=new PriceStore(getStorage().bucket(bucketName));
 try{
  const result=mode==='export'?await exportPrices(getFirestore(),store,{maxReads:Number(process.env.PRICE_MIGRATION_MAX_READS??2000000),maxDurationMs:1200000}):
   mode==='catchup'?await catchUpPrices(getFirestore(),store,Number(process.env.PRICE_MIGRATION_MAX_READS??50000)):
   mode==='compact'?await compactPrices(store):await readHead(store.bucket).then(h=>({generation:h.generation,ready:h.manifest.ready,files:h.manifest.files.length,rows:h.manifest.files.reduce((n,f)=>n+f.rows,0),watermark:h.manifest.watermark}));
  console.info(JSON.stringify({event:'price_parquet_migration',mode,...result}));
 }finally{await store.close();}
}
main().catch(error=>{console.error(JSON.stringify({severity:'ERROR',event:'price_parquet_migration_failed',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;});
