import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {Storage} from '@google-cloud/storage';
import {MarketFiles,MARKET_ROOT} from '../src/lib/market-store/files';
import {bundleMarketIndexes} from '../src/lib/market-store/index-bundles';
import {CleanupGate,migrationCapacity} from './market-migration-safety';

/** Run after bundle-aware readers are deployed and legacy staged readers are retired. */
async function main(){
    assert.equal(process.env.GOOGLE_CLOUD_PROJECT,'ifindata-80905');
    assert.equal(process.env.MARKET_OPERATION,'bundle-indexes');
    assert(!process.env.FIRESTORE_EMULATOR_HOST);
    initializeApp({projectId:'ifindata-80905',credential:applicationDefault()});
    const db=getFirestore(),bucket=new Storage().bucket('ifindata-80905-eodhd-bulk-eod'),files=new MarketFiles(bucket,0);
    const gate=new CleanupGate(migrationCapacity('ifindata-80905'),50);
    const root=`${MARKET_ROOT}/operator/${new Date().toISOString().replaceAll(':','-')}`;
    try{
        const results=await bundleMarketIndexes(db,files,{ready:false,before:count=>gate.before(count),
            prepared:async(before,after)=>{await bucket.file(`${root}/heads/${before[0].collection}/${before[0].shard}-${randomUUID()}.json`).save(JSON.stringify({before,after}),{resumable:false,preconditionOpts:{ifGenerationMatch:0}});},
            completed:result=>console.info(JSON.stringify({event:'market_index_bundle_collection',...result}))});
        const audit={event:'market_index_bundles_complete',at:new Date().toISOString(),root,results};
        await bucket.file(root+'/index-bundles.json').save(JSON.stringify(audit),{resumable:false,preconditionOpts:{ifGenerationMatch:0}});
        console.info(JSON.stringify(audit));
    }finally{await files.close();await db.terminate();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
