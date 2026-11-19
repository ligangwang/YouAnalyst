import assert from 'node:assert/strict';
import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {Storage} from '@google-cloud/storage';
import {MarketFiles,type MarketHead} from '../src/lib/market-store/files';
import {headId} from '../src/lib/market-store/repository';
import {fundamentalsReceiptId} from '../src/lib/market-store/policy';
import {archiveReceiptBatch} from '../src/lib/market-store/archive-fundamentals-receipts';
import {CleanupGate,migrationCapacity} from './market-migration-safety';

async function main(){
    const project='ifindata-80905';
    assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);
    assert(!process.env.FIRESTORE_EMULATOR_HOST);
    const start=Number(process.env.START_SHARD??0),end=Number(process.env.END_SHARD??256);
    assert(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&start<end&&end<=256);
    initializeApp({projectId:project,credential:applicationDefault()});
    const db=getFirestore(),files=new MarketFiles(new Storage().bucket('ifindata-80905-eodhd-bulk-eod'));
    const gate=new CleanupGate(migrationCapacity(project),50);
    try{
        for(let n=start;n<end;n++){
            const shard=n.toString(16).padStart(2,'0');
            const head=(await db.collection('collectors').doc(headId('company_fundamentals',shard)).get()).get('marketHead') as MarketHead;
            assert(head.collection==='company_fundamentals'&&head.shard===shard);
            const ids=head.retained.filter(fundamentalsReceiptId);
            let archived=0;
            for(let offset=0;offset<ids.length;offset+=100){
                const batch=ids.slice(offset,offset+100);
                await gate.before(batch.length);
                archived+=await archiveReceiptBatch(db,files,shard,batch);
            }
            console.log(JSON.stringify({shard,candidates:ids.length,archived}));
        }
    }finally{await files.close();await db.terminate();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
