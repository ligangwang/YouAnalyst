import {Firestore} from '@google-cloud/firestore';
import {randomUUID} from 'node:crypto';
const db=new Firestore({projectId:process.env.GCP_PROJECT_ID});
const ref=db.collection('collectors').doc('_read_cache_versions_v1');
if(process.argv.includes('--disable')){
  await ref.set({enabled:false},{merge:true});
  console.log('Change cache bypassed during receiver setup');
  process.exit(0);
}
// A real Firestore write must reach the authenticated Eventarc receiver first.
const nonce=randomUUID(), probe=db.collection('collectors').doc('cache-change-probe');
await probe.set({nonce});
let delivered=false;
for(let attempt=0;attempt<60;attempt++){
  const after=(await ref.get()).get('probeNonce');
  if(after===nonce){delivered=true;break;}
  await new Promise(resolve=>setTimeout(resolve,5000));
}
if(!delivered)throw Error('Cache event delivery was not verified; cache activation stopped');
const collections=['companies','company_relationships','company_fundamentals','eod_prices','corporate_actions','earnings_records','collectors','events','users','directory_syncs','predictions','watchlists'];
await ref.set({enabled:true,versions:Object.fromEntries(collections.map(name=>[name,randomUUID()]))},{merge:true});
await probe.delete();
console.log('Change-driven cache activated after a live delivery');
