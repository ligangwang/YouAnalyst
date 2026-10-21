import {syncSnapshotInstruments} from '../src/lib/instruments/snapshot-sync';
import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getStorage} from 'firebase-admin/storage';
import {getFirestore} from '../src/lib/firebase/firestore';
import {collections,syncCollection} from '../src/lib/entity-snapshots/sync';
import {snapshotSource} from '../src/lib/entity-snapshots/firestore-source';
import {snapshotFiles} from '../src/lib/entity-snapshots/storage';

async function main(){
  const projectId=process.env.GCP_PROJECT_ID,bucketName=process.env.ENTITY_SNAPSHOT_BUCKET;
  if(!projectId||!bucketName)throw Error('GCP_PROJECT_ID and ENTITY_SNAPSHOT_BUCKET are required');
  if(process.env.ENTITY_TIMESTAMP_MIGRATION_COMPLETE!=='1')throw Error('Verify entity timestamp migration before enabling snapshot sync');
  initializeApp({credential:applicationDefault(),projectId});
  const db=getFirestore(),source=snapshotSource(db),files=snapshotFiles(getStorage().bucket(bucketName));
  let changed=0,records=0,deleted=0;
  for(const collection of collections){
    if(collection==='instruments'){
      const companies=(await files.load('companies')).snapshot;
      if(!companies)throw Error('Company snapshot required before instrument sync');
      let instruments=(await files.load('instruments')).snapshot;
      if(!instruments){await syncCollection('instruments',source,files);instruments=(await files.load('instruments')).snapshot;}
      const synchronized=await syncSnapshotInstruments(db,companies,instruments);
      console.info(JSON.stringify({job:'sync-entity-snapshots',event:'instrument_directory_sync',...synchronized}));
    }
    const result=await syncCollection(collection,source,files);
    changed+=result.changed;records+=result.records;deleted+=result.deleted;
    console.info(JSON.stringify({job:'sync-entity-snapshots',event:'entity_snapshot_sync',status:'success',...result}));
  }
  console.info(JSON.stringify({severity:'INFO',job:'sync-entity-snapshots',message:'sync-entity-snapshots: run_completed',updated:changed,count:records,deleted}));
}
main().catch(error=>{console.error(JSON.stringify({severity:'ERROR',job:'sync-entity-snapshots',message:'sync-entity-snapshots: run_failed',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;});
