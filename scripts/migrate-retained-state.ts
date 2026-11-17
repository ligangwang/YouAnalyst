import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore,FieldPath,type Query} from 'firebase-admin/firestore';
import {Storage} from '@google-cloud/storage';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RETAINED_CONTROL,retainedMode,retainedPath,retainedRoot,relocatesCollection} from '../src/lib/market-store/retained-store';
import {reconcileRetainedRecords} from '../src/lib/market-store/retained-migration';
import {CONTROL} from '../src/lib/market-store/repository';
import {FUNDAMENTALS_CONTROL} from '../src/lib/market-store/fundamentals-control';
import {EVENTS_CONTROL} from '../src/lib/market-store/events-control';
import {encode} from '../src/lib/central-cache/codec';
import {CleanupGate,migrationCapacity,capacityRegression,type CapacitySample} from './market-migration-safety';
import type {MarketCollection} from '../src/lib/market-store/policy';
import {flushBulkWrites} from './lib/flush-bulk-writes';
import {boundedOperatorWork} from './lib/bounded-operator-work';
import {auditRetainedPage} from './lib/audit-retained-page';

// Explicit operator only. No bootstrap or read-gate switch is performed here.
async function main(){
    const project=process.env.GCP_PROJECT_ID,bucketName=process.env.ENTITY_SNAPSHOT_BUCKET;
    const operation=process.argv[2],collection=process.argv[3];
    if(project!=='ifindata-80905'||!bucketName||!['copy','reconcile','verify','delete'].includes(operation)
        ||!collection||!relocatesCollection(collection))throw Error('Explicit project, bucket, operation and migrated collection required');
    initializeApp({projectId:project,credential:applicationDefault()});
    const raw=getFirestore(),bucket=new Storage({projectId:project}).bucket(bucketName);
    const startedAt=new Date().toISOString(),root=`market-parquet/v1/operator/retained-${startedAt.replaceAll(':','-')}/${collection}`;
    const gate=new CleanupGate(migrationCapacity(project),1000);
    const inspect=migrationCapacity(project);let initial:CapacitySample|undefined;
    const guard=async(count:number)=>{
        if(operation!=='delete'){for(let n=0;n<count;n+=100)await gate.before(Math.min(100,count-n));return;}
        // The user explicitly requested no fixed deletion-rate cap. Only one
        // bounded page is in flight; inspect capacity before EVERY next page.
        const sample=await inspect();initial??=sample;
        const failure=capacityRegression(initial,sample);if(failure)throw Error(failure);
    };
    const writer=raw.bulkWriter({throttling:false});
    writer.onWriteError(error=>[4,10,14].includes(Number(error.code))&&error.failedAttempts<4);
    let read=0,written=0,skipped=0,pageNumber=0;
    const ids=createHash('sha256');
    try{
        const control=await raw.doc(collection==='company_fundamentals'?FUNDAMENTALS_CONTROL:CONTROL).get();
        if(control.get('ready')!==true||!control.get('cleanedCollections')?.includes(collection))throw Error('External payload retirement is incomplete');
        if((await raw.doc(EVENTS_CONTROL).get()).get('ready')!==false)throw Error('Events must remain deferred');
        if(operation==='delete'){
            const path=process.env.MARKET_VERIFICATION_PROOF;
            if(!path?.startsWith('market-parquet/v1/operator/'))throw Error('Production verification proof is required');
            const proof=JSON.parse((await bucket.file(path).download())[0].toString());
            for(const key of ['uiPassed','apiPassed','performancePassed','workersPassed','ugcPassed','retainedParityPassed','oldWritersDrained'])
                if(proof[key]!==true)throw Error(`Missing production verification: ${key}`);
            if(!proof.collections?.includes(collection)||proof.collections.includes('events'))throw Error('Collection is outside verified removal scope');
            const health=await fetch('https://ifindata-web-zcgfwde4aa-uc.a.run.app/api/health',{signal:AbortSignal.timeout(30000)}).then(response=>response.json());
            if(health.status!=='ok'||health.commitSha!==proof.commit||health.revision!==proof.revision)throw Error('Verified production revision changed');
        }
        const check=async()=>{
            const doc=await raw.doc(RETAINED_CONTROL).get(),mode=retainedMode(doc);
            if(operation==='delete'){
                if(!mode.ready||!mode.cleanupAuthorized)throw Error('Verified source-removal authorization is missing');
            }else if(!mode.enabled||mode.ready||mode.cleanupAuthorized)throw Error('Backfill requires the mirror phase');
        };
        await check();
        const scan=async(path:string,visit:(docs:FirebaseFirestore.QueryDocumentSnapshot[])=>Promise<void>)=>{
            const pages=async function*(){let cursor:string|undefined;
            for(;;){
                await check();
                const limit=1000;
                let query:Query=raw.collection(path).orderBy(FieldPath.documentId()).limit(limit);
                if(operation==='reconcile'||operation==='verify')query=query.select();
                if(cursor)query=query.startAfter(cursor);
                const page=await query.get();if(!page.size)break;
                // Audits only read; throttle actual repairs separately below.
                await guard(operation==='reconcile'||operation==='verify'?1:page.size);yield page.docs;
                cursor=page.docs.at(-1)!.id;if(page.size<limit)break;
            }};
            // Copy into unused destinations with one shared rate/capacity guard.
            // Deletion remains one page at a time, checked before every page.
            await boundedOperatorWork(pages(),operation==='copy'?4:1,visit);
        };
        const reconcile=async(docs:FirebaseFirestore.QueryDocumentSnapshot[])=>{
            const mismatches=await auditRetainedPage(raw,collection,docs.map(doc=>doc.id));
            if(operation==='verify'&&mismatches.length)throw Error('Retained-state parity failed');
            const batches=Array.from({length:Math.ceil(mismatches.length/100)},(_,n)=>mismatches.slice(n*100,n*100+100));
            await boundedOperatorWork(batches,4,async ids=>{
                await guard(ids.length);
                const result=await reconcileRetainedRecords(raw,collection,ids);written+=result.changed;
            });
        };
        await scan(collection,async docs=>{
            read+=docs.length;for(const doc of docs)ids.update(doc.id+'\n');
            if(operation==='copy'||operation==='delete'){
                // Every source page is recoverable before copying or removal.
                const backup=encode(docs.map(doc=>({id:doc.id,data:doc.data(),updateTime:doc.updateTime})));
                await bucket.file(`${root}/source-${String(pageNumber++).padStart(7,'0')}.json.gz`).save(gzipSync(JSON.stringify(backup)),
                    {resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/gzip'}});
                const results=await flushBulkWrites(writer,docs.map(doc=>operation==='delete'
                    ?writer.delete(doc.ref,{lastUpdateTime:doc.updateTime})
                    :writer.create(raw.doc(retainedPath(retainedRoot(collection,doc.id,doc.data()),collection,doc.id)),doc.data())));
                for(const result of results){
                    if(result.status==='fulfilled')written++;
                    else if(operation==='copy'&&Number(result.reason?.code)===6)skipped++;
                    else throw result.reason;
                }
            }else{
                await reconcile(docs);
            }
            if(read%5000===0)console.info(JSON.stringify({operation,collection,read,written,skipped}));
        });
        if(operation==='reconcile'||operation==='verify'){
            // Source scans alone cannot find a stale destination for a deleted ID.
            for(const destination of ['market_state','market_ugc'])await scan(`${destination}/${collection}/records`,async docs=>{
                await reconcile(docs);
            });
        }
        if(operation==='delete'&&(await raw.collection(collection).limit(1).get()).size)throw Error('Source collection is not empty');
        const audit={startedAt,completedAt:new Date().toISOString(),operation,collection:collection as MarketCollection,read,written,skipped,sourceIdSha256:ids.digest('hex'),root};
        await bucket.file(`${root}/audit.json`).save(JSON.stringify(audit),{resumable:false,preconditionOpts:{ifGenerationMatch:0}});
        console.info(JSON.stringify({passed:true,...audit}));
    }finally{await writer.close();await raw.terminate();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
