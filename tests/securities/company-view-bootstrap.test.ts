import test from 'node:test';
import assert from 'node:assert/strict';
import {Firestore,Timestamp,type QuerySnapshot,type DocumentSnapshot} from 'firebase-admin/firestore';
import {CompanyView} from '../../src/lib/market-store/company-view';

function fixture(){
    const raw=new Firestore({projectId:'company-bootstrap-test'});
    let next!:(snapshot:QuerySnapshot)=>void,error!:(error:Error)=>void,attempts=0,stops=0,now=0;
    const client={doc:raw.doc.bind(raw),collectionGroup:()=>({where:()=>({onSnapshot:(callback:typeof next,onError:typeof error)=>{
        attempts++;next=callback;error=onError;return ()=>{stops++;};
    }})})} as unknown as Firestore;
    const view=new CompanyView(client,()=>{},undefined,{initializationTimeoutMs:10,retryDelayMs:100,now:()=>now});
    const deliver=()=>{
        const doc={id:'US:A',ref:{path:'market_state/companies/records/US:A'},data:()=>({pending:true})} as DocumentSnapshot;
        next({docChanges:()=>[{type:'added',doc}],readTime:Timestamp.now()} as QuerySnapshot);
    };
    return {raw,view,deliver,fail:()=>error(Error('unavailable')),advance:()=>{now+=101;},counts:()=>({attempts,stops})};
}

test('slow company bootstrap releases requests but completes on the original subscription',async t=>{
    const f=fixture();t.after(async()=>{f.view.close();await f.raw.terminate();});
    const waiting=f.view.read(true);
    assert.equal(await f.view.read(),undefined,'point reads do not wait');
    assert.equal(await waiting,undefined,'broad request falls back after bounded wait');
    for(let n=0;n<5;n++)assert.equal(await f.view.read(true),undefined);
    assert.deepEqual(f.counts(),{attempts:1,stops:0},'timeout must not restart the expensive snapshot');
    f.deliver();
    assert.equal((await f.view.read(true))?.get('US:A')?.data()?.pending,true);
    assert.deepEqual(f.counts(),{attempts:1,stops:0});
});

test('explicit close cancels a slow subscription and ignores its late snapshot',async t=>{
    const f=fixture();t.after(async()=>{f.view.close();await f.raw.terminate();});
    assert.equal(await f.view.read(true),undefined);
    f.view.close();f.deliver();
    assert.equal(await f.view.read(true),undefined);
    assert.deepEqual(f.counts(),{attempts:1,stops:1});
});

test('a real listener failure after the wait expires still uses cooldown and one retry',async t=>{
    const f=fixture();t.after(async()=>{f.view.close();await f.raw.terminate();});
    await f.view.read(true);f.fail();
    assert.equal(await f.view.read(true),undefined);
    assert.deepEqual(f.counts(),{attempts:1,stops:1});
    f.advance();const first=f.view.read(true),second=f.view.read(true);
    assert.equal(await f.view.read(),undefined);
    f.deliver();
    assert.equal(await first,await second);
    assert.deepEqual(f.counts(),{attempts:2,stops:1});
});
