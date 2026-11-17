import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {DocumentSnapshot} from 'firebase-admin/firestore';
import {retainedMode,retainedRoot,retainedPath,relocatesCollection} from '../../src/lib/market-store/retained-store';
const snapshot=(data?:Record<string,unknown>)=>({exists:!!data,data:()=>data}) as unknown as DocumentSnapshot;
test('retained routing preserves authored records and keeps events out of relocation',()=>{
    assert.equal(retainedRoot('company_fundamentals','_worker',{leaseOwner:'worker'}),'market_state');
    assert.equal(retainedRoot('companies','US:A',{onboarding:{status:'SUPPORTED'}}),'market_state');
    assert.equal(retainedRoot('companies','US:A',{name:'Reviewed',reviewedBy:'user'}),'market_ugc');
    assert.equal(retainedRoot('company_relationships','edge',{source:'US:A',target:'US:B',status:'PUBLISHED'}),'market_ugc');
    assert.equal(retainedRoot('company_relationships','edge',{recordKind:'FILING_OBSERVATION',pending:true}),'market_state');
    assert.equal(retainedPath('market_ugc','companies','US:A'),'market_ugc/companies/records/US:A');
    assert.equal(relocatesCollection('events'),false);assert.equal(relocatesCollection('users'),false);
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
