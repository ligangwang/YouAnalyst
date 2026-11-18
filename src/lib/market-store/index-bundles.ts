import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Firestore} from 'firebase-admin/firestore';
import {PARQUET_MARKET_COLLECTIONS,type MarketCollection} from './policy';
import {MarketFiles,type MarketHead} from './files';
import {CONTROL,headId} from './repository';
import {EVENTS_CONTROL} from './events-control';
import {FUNDAMENTALS_CONTROL} from './fundamentals-control';
import {compactHead,pointerId,pointerCollection} from './head-pointer';
import {marketIndexBundled} from './index-fields';

type Result={collection:MarketCollection;changed:number;skipped:number;rows:number};
/** Immutable indexes are published only if all source heads still match. The
 * same operation supports staged rollout and the existing daily maintenance job. */
export async function bundleMarketIndexes(raw:Firestore,files:MarketFiles,options:{ready:boolean;before:(writes:number)=>Promise<void>;collections?:readonly MarketCollection[];companyHeads?:(heads:MarketHead[])=>void;prepared?:(before:MarketHead[],after:MarketHead[])=>Promise<void>;completed?:(result:Result)=>void}){
    const results:Result[]=[];
    const controlCheck=(data:FirebaseFirestore.DocumentSnapshot)=>{
        assert.equal(data.get('ready'),options.ready);
        if(!options.ready)assert.notEqual(data.get('cleanupAuthorized'),true);
    };
    for(const collection of options.collections??PARQUET_MARKET_COLLECTIONS){
        const control=collection==='events'?EVENTS_CONTROL:collection==='company_fundamentals'?FUNDAMENTALS_CONTROL:CONTROL;
        if((collection==='events'||collection==='company_fundamentals')&&options.ready&&(await raw.doc(control).get()).get('ready')!==true)continue;
        let changed=0,skipped=0,rows=0;
        for(let start=0;start<256;start+=16){
            const shards=Array.from({length:16},(_,i)=>(start+i).toString(16).padStart(2,'0'));
            let published=false;
            for(let attempt=0;attempt<3&&!published;attempt++){
                // Check capacity before reading/building; reserve actual metadata
                // writes only at publication, so unchanged groups do not idle.
                await options.before(1);controlCheck(await raw.doc(control).get());
                const docs=await raw.getAll(...shards.map(shard=>raw.collection('collectors').doc(headId(collection,shard))));
                const heads=docs.map((doc,i)=>{const head=doc.get('marketHead') as MarketHead;assert(head&&head.collection===collection&&head.shard===shards[i]);return head;});
                const indexed=heads.filter(head=>head.file&&head.indexFile);
                if(indexed.length<2||indexed.every(head=>marketIndexBundled(head.format))&&new Set(indexed.map(head=>head.indexFile)).size===1){if(collection==='companies')options.companyHeads?.(heads);skipped+=indexed.length;published=true;break;}
                const bundled=await files.bundleIndexes(indexed);
                await options.prepared?.(indexed,bundled);
                await options.before(bundled.length*2);
                const committed=await raw.runTransaction(async tx=>{
                    controlCheck(await tx.get(raw.doc(control)));
                    const latest=await tx.getAll(...docs.map(doc=>doc.ref));
                    if(latest.some((doc,i)=>!isDeepStrictEqual(doc.get('marketHead'),heads[i])))return false;
                    const published=bundled.map(head=>({...head,revision:randomUUID()}));
                    for(const next of published){
                        tx.set(raw.collection('collectors').doc(headId(collection,next.shard)),{marketCollection:collection,marketHead:next});
                        tx.set(raw.collection('collectors').doc(pointerId(collection,next.shard)),{marketCollection:pointerCollection(collection),marketHead:compactHead(next)});
                    }
                    return published;
                });
                if(committed){
                    if(collection==='companies')options.companyHeads?.(heads.map(head=>committed.find(next=>next.shard===head.shard)??head));
                    published=true;changed+=bundled.length;rows+=bundled.reduce((n,head)=>n+head.rows,0);}
            }
            assert(published,`Concurrent writes prevented safe bundle publication: ${collection}/${shards[0]}`);
        }
        const result={collection,changed,skipped,rows};results.push(result);options.completed?.(result);
    }
    return results;
}
