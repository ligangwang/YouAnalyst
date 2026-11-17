import {queueFundamentalsSeeding} from '../src/lib/fundamentals/seed-queue';
import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getStorage} from 'firebase-admin/storage';
import {getFirestore} from '../src/lib/firebase/firestore';
import {snapshotSyncOptions} from '../src/lib/entity-snapshots/cli';
import {getFirestore as rawFirestore,FieldPath} from 'firebase-admin/firestore';
import {CONTROL} from '../src/lib/market-store/repository';
import {collectMarketGarbage} from '../src/lib/market-store/maintenance';
import {MarketFiles} from '../src/lib/market-store/files';
import {bundleMarketIndexes} from '../src/lib/market-store/index-bundles';
import {CleanupGate,migrationCapacity} from './market-migration-safety';

async function main(){
  const {dispatchInstruments}=snapshotSyncOptions(process.argv.slice(2));
  const projectId=process.env.GCP_PROJECT_ID,bucketName=process.env.ENTITY_SNAPSHOT_BUCKET;
  if(!projectId||!bucketName)throw Error('GCP_PROJECT_ID and ENTITY_SNAPSHOT_BUCKET are required');
  if(process.env.ENTITY_TIMESTAMP_MIGRATION_COMPLETE!=='1')throw Error('Verify entity timestamp migration before enabling snapshot sync');
  initializeApp({credential:applicationDefault(),projectId});
  const raw=rawFirestore();
  if((await raw.doc(CONTROL).get()).get('ready')!==true){
    await raw.terminate();
    throw Error('Parquet must be ready; legacy Firestore snapshot publication is retired');
  }
    const db=getFirestore();
    try{
      if(dispatchInstruments){
        const companies=await db.collection('companies').select('isDeleted').orderBy(FieldPath.documentId()).get();
        const ids=companies.docs.filter(doc=>doc.get('isDeleted')!==true).map(doc=>doc.id);
        const synchronized=await queueFundamentalsSeeding(db,process.env.CLOUD_RUN_EXECUTION??`market-${Date.now()}`,ids,'sec-fundamentals-requests','instruments');
        console.info(JSON.stringify({job:'sync-entity-snapshots',event:'instrument_directory_sync',...synchronized}));
      }
      const bucket=getStorage().bucket(bucketName),files=new MarketFiles(bucket,0);
      const gate=new CleanupGate(migrationCapacity(projectId),50);
      let indexShards=0;
      try{
        const results=await bundleMarketIndexes(raw,files,{ready:true,before:count=>gate.before(count)});
        indexShards=results.reduce((sum,result)=>sum+result.changed,0);
      }finally{await files.close();}
      const garbage=await collectMarketGarbage(raw,bucket);
      console.info(JSON.stringify({severity:'INFO',job:'sync-entity-snapshots',message:'sync-entity-snapshots: run_completed',storage:'parquet',indexShards,...garbage}));
    }finally{await db.terminate();}
}
main().catch(error=>{console.error(JSON.stringify({severity:'ERROR',job:'sync-entity-snapshots',message:'sync-entity-snapshots: run_failed',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;});
