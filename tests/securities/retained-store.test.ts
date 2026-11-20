import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {DocumentSnapshot,Firestore,Query} from 'firebase-admin/firestore';
import {RetainedStore,retainedMode,retainedRoot,retainedPath,relocatesCollection} from '../../src/lib/market-store/retained-store';
const snapshot=(data?:Record<string,unknown>)=>({exists:!!data,data:()=>data}) as unknown as DocumentSnapshot;
test('queries retain one snapshot when a curated edit moves a record between roots',async()=>{
    let location='market_state',transactions=0;
    const page=(path:string,at:string)=>({docs:path.startsWith(at)?[{id:'US:A',ref:{path:path+'/US:A'},data:()=>({name:'A'})}]:[]});
    const raw={
        doc:()=>({get:async()=>snapshot({version:1,ready:true,cleanupAuthorized:false})}),
        collection:(path:string)=>({doc:(id:string)=>({id,path:path+'/'+id})}),
        runTransaction:async(work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{
            assert.deepEqual(options,{readOnly:true});transactions++;
            const at=location;
            return work({get:async(query:{path:string})=>{const result=page(query.path,at);location='market_ugc';return result;}});
        },
    } as unknown as Firestore;
    const store=new RetainedStore(raw);
    const build=(path:string)=>({path,get:async()=>{throw Error('Independent snapshots are unsafe');}}) as unknown as Query;
    const before=await store.query('companies',build),after=await store.query('companies',build);
    assert.equal(transactions,2);
    for(const docs of [before,after]){assert.deepEqual(docs.map(doc=>doc.id),['US:A']);assert.equal(docs[0].ref.path,'companies/US:A');}
});
test('retained routing preserves authored records and keeps events out of relocation',()=>{
    assert.equal(retainedRoot('company_fundamentals','_worker',{leaseOwner:'worker'}),'market_state');
    assert.equal(retainedRoot('companies','US:A',{onboarding:{status:'SUPPORTED'}}),'market_state');
    assert.equal(retainedRoot('companies','US:A',{name:'Reviewed',reviewedBy:'user'}),'market_ugc');
    assert.equal(retainedRoot('company_relationships','edge',{source:'US:A',target:'US:B',status:'PUBLISHED'}),'market_ugc');
    assert.equal(retainedRoot('company_relationships','edge',{recordKind:'FILING_OBSERVATION',pending:true}),'market_state');
    assert.equal(retainedPath('market_ugc','companies','US:A'),'market_ugc/companies/records/US:A');
    assert.equal(relocatesCollection('events'),false);assert.equal(relocatesCollection('users'),false);
    assert.equal(relocatesCollection('prediction_daily_marks'),false);
});
test('retained stores cannot authorize removal before read cutover',()=>{
    assert.deepEqual(retainedMode(snapshot()),{enabled:false,ready:false,cleanupAuthorized:false});
    assert.deepEqual(retainedMode(snapshot({version:1,ready:false,cleanupAuthorized:false})),{enabled:true,ready:false,cleanupAuthorized:false});
    assert.throws(()=>retainedMode(snapshot({version:1,ready:false,cleanupAuthorized:true})),/Invalid/);
    assert.throws(()=>retainedMode(snapshot({version:1,ready:true})),/Invalid/);
    assert.equal(retainedMode(snapshot({version:1,ready:true,cleanupAuthorized:true})).cleanupAuthorized,true);
});
test('relocated records preserve the composite indexes required by existing queries',()=>{
    const config=JSON.parse(readFileSync('firestore.indexes.json','utf8'));
    const keys=new Set(config.indexes.filter((index:{collectionGroup:string})=>index.collectionGroup==='records').map((index:{queryScope:string;fields:unknown})=>JSON.stringify([index.queryScope,index.fields])));
    for(const index of config.indexes)if(relocatesCollection(index.collectionGroup))assert(keys.has(JSON.stringify([index.queryScope,index.fields])),`Missing retained index for ${index.collectionGroup}`);
});
test('a missing preferred location is probed once while an editorial move races the alternate lookup',async()=>{
    const path='company_relationships/edge',preferred=retainedPath('market_ugc','company_relationships','edge');
    const other=retainedPath('market_state','company_relationships','edge');
    const ref={id:'edge',path,parent:{id:'company_relationships'}};
    let live=other;
    const reads:string[]=[];
    const raw={
        doc:(physical:string)=>({path:physical,get:async()=>snapshot({version:1,ready:true,cleanupAuthorized:true})}),
        runTransaction:async(work:(tx:unknown)=>Promise<unknown>,options:unknown)=>{
            assert.deepEqual(options,{readOnly:true});
            const fixed=live;
            return work({getAll:async(location:{path:string})=>{
                reads.push(location.path);
                live=preferred;
                return [{ref:location,exists:location.path===fixed,data:()=>({status:'PUBLISHED'})}];
            }});
        },
    } as unknown as Firestore;
    const store=new RetainedStore(raw);
    const [doc]=await store.documents([ref as FirebaseFirestore.DocumentReference]);
    assert.equal(doc.exists,true);
    assert.equal(doc.ref.path,path);
    assert.deepEqual(reads,[preferred,other]);
});
