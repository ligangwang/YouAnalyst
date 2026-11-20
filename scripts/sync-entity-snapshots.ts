import {queueFundamentalsSeeding} from '../src/lib/fundamentals/seed-queue';
import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getStorage} from 'firebase-admin/storage';
import {getFirestore} from '../src/lib/firebase/firestore';
import {snapshotSyncOptions} from '../src/lib/entity-snapshots/cli';
import {getFirestore as rawFirestore} from 'firebase-admin/firestore';
import {CONTROL} from '../src/lib/market-store/repository';
import {collectMarketGarbage} from '../src/lib/market-store/maintenance';
import {publishDirectoryIndex} from '../src/lib/market-store/publish-directory-index';
import {MarketFiles,type MarketHead} from '../src/lib/market-store/files';
import {bundleMarketIndexes} from '../src/lib/market-store/index-bundles';
import {completeRecordsInParquet} from '../src/lib/market-store/runtime';
import {instrumentId} from '../src/lib/instruments/model';
import {companyInstrumentFields, instrumentComparisonFields, companyInstrumentNeedsSync} from '../src/lib/instruments/snapshot-sync';
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
        const ready = await Promise.all((['companies','instruments'] as const).map(name => completeRecordsInParquet(db,name)));
        if (ready.some(value => !value)) throw Error('Complete company and instrument Parquet catalogs are required');
        const [companies,instruments] = await Promise.all([
          db.collection('companies').select(...companyInstrumentFields).get(),
          db.collection('instruments').select(...instrumentComparisonFields).get(),
        ]);
        const existing = new Map(instruments.docs.map(doc => [doc.id,doc.data()]));
        const ids = companies.docs
          .filter(doc => companyInstrumentNeedsSync(doc.id, doc.data(), existing.get(instrumentId(doc.id))))
          .map(doc => doc.id);
        const synchronized = ids.length
          ? await queueFundamentalsSeeding(db,process.env.CLOUD_RUN_EXECUTION??`market-${Date.now()}`,ids,'sec-fundamentals-requests','instruments')
          : {queued:false,requested:0};
        console.info(JSON.stringify({job:'sync-entity-snapshots',event:'instrument_directory_sync',compared:companies.size,...synchronized}));
      }
      const bucket=getStorage().bucket(bucketName),files=new MarketFiles(bucket,0);
      const gate=new CleanupGate(migrationCapacity(projectId),50);
      let indexShards=0;
      try{
        const companies:MarketHead[]=[];
        const results=await bundleMarketIndexes(raw,files,{ready:true,before:count=>gate.before(count),companyHeads:heads=>companies.push(...heads)});
        indexShards=results.reduce((sum,result)=>sum+result.changed,0);
        const garbage=await collectMarketGarbage(raw,bucket);
        await publishDirectoryIndex(raw,files,companies);
      console.info(JSON.stringify({severity:'INFO',job:'sync-entity-snapshots',message:'sync-entity-snapshots: run_completed',storage:'parquet',indexShards,...garbage}));
      }finally{await files.close();}
    }finally{await db.terminate();}
}
main().catch(error=>{console.error(JSON.stringify({severity:'ERROR',job:'sync-entity-snapshots',message:'sync-entity-snapshots: run_failed',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;});
