import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {Storage} from '@google-cloud/storage';
import {MARKET_COLLECTIONS} from '../src/lib/market-store/policy';
import {CONTROL,headId} from '../src/lib/market-store/repository';
import {compactHead,pointerId,pointerCollection,pointerHasRetained} from '../src/lib/market-store/head-pointer';
import {MARKET_ROOT,type MarketHead} from '../src/lib/market-store/files';
import {CleanupGate,migrationCapacity} from './market-migration-safety';

/** Additive metadata backfill. Enable pointer readers only after every active
 * writer publishes both documents; original heads remain authoritative here. */
async function main(){
    assert.equal(process.env.GOOGLE_CLOUD_PROJECT,'ifindata-80905');
    assert(['compact-heads','verify-compact-heads'].includes(process.env.MARKET_OPERATION??''));
    assert(!process.env.FIRESTORE_EMULATOR_HOST);
    initializeApp({projectId:'ifindata-80905',credential:applicationDefault()});
    const db=getFirestore(),bucket=new Storage().bucket('ifindata-80905-eodhd-bulk-eod');
    const gate=new CleanupGate(migrationCapacity('ifindata-80905'),50),verify=process.env.MARKET_OPERATION==='verify-compact-heads';
    const results:unknown[]=[],root=`${MARKET_ROOT}/operator/${new Date().toISOString().replaceAll(':','-')}`;
    try{
        for(const collection of MARKET_COLLECTIONS){
            let cursor=0,originalBytes=0,pointerBytes=0,updated=0,failed:unknown;
            const workers=await Promise.allSettled(Array.from({length:2},async()=>{try{
                for(;;){
                    if(failed)return;
                    const start=cursor;cursor+=16;if(start>=256)return;
                    const shards=Array.from({length:16},(_,i)=>(start+i).toString(16).padStart(2,'0'));
                    await gate.before(16);
                    if(failed)return;
                    const result=await db.runTransaction(async tx=>{
                        const control=await tx.get(db.doc(CONTROL));assert.equal(control.get('ready'),false);assert.notEqual(control.get('cleanupAuthorized'),true);
                        const originals=await tx.getAll(...shards.map(shard=>db.collection('collectors').doc(headId(collection,shard))));
                        const pointers=await tx.getAll(...shards.map(shard=>db.collection('collectors').doc(pointerId(collection,shard))));
                        let changed=0,sourceBytes=0,packedBytes=0;
                        for(let i=0;i<shards.length;i++){
                            const head=originals[i].get('marketHead') as MarketHead;
                            assert(head&&head.collection===collection&&head.shard===shards[i]&&Array.isArray(head.retained));
                            const packed=compactHead(head);assert.deepEqual({...packed,retained:head.retained},head);assert.equal(pointerHasRetained(packed),head.retained.length>0);
                            const value={marketCollection:pointerCollection(collection),marketHead:packed};
                            sourceBytes+=Buffer.byteLength(JSON.stringify(head));packedBytes+=Buffer.byteLength(JSON.stringify(packed));
                            if(!isDeepStrictEqual(pointers[i].data(),value)){
                                assert(!verify,`Stale compact head: ${collection}/${shards[i]}`);
                                tx.set(pointers[i].ref,value);changed++;
                            }
                        }
                        return {changed,sourceBytes,packedBytes};
                    });
                    updated+=result.changed;originalBytes+=result.sourceBytes;pointerBytes+=result.packedBytes;
                }
            }catch(error){failed=error;throw error;}
            }));
            const rejected=workers.find(result=>result.status==='rejected');if(rejected?.status==='rejected')throw rejected.reason;
            const result={collection,shards:256,updated,originalBytes,pointerBytes};results.push(result);
            console.info(JSON.stringify({event:'compact_heads_collection',...result}));
        }
        const audit={event:'compact_heads_complete',verify,at:new Date().toISOString(),root,results};
        await bucket.file(root+'/compact-heads.json').save(JSON.stringify(audit),{resumable:false,preconditionOpts:{ifGenerationMatch:0}});
        console.info(JSON.stringify(audit));
    }finally{await db.terminate();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
