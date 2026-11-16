import test from 'node:test';
import assert from 'node:assert/strict';
import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import {MarketRepository} from '../../src/lib/market-store/repository';
import {shardFor,type MarketFiles,type MarketHead,type MarketRow} from '../../src/lib/market-store/files';

function fixture(){
    const id='bootstrap-event',shard=shardFor(id),time=(n:number)=>Timestamp.fromMillis(n);
    const head:MarketHead={collection:'events',shard,file:'external.parquet',rows:1,retained:[id],revision:'same',format:6};
    let emit!:(value:unknown)=>void,project!:(value:unknown)=>void,reads=0;const selected:string[][]=[];
    const document=(head:MarketHead)=>({exists:true,get:(field:string)=>field==='marketHead'?head:head.shard});
    const snapshot=(head:MarketHead,at:number)=>({docs:[document(head)],readTime:time(at),docChanges:()=>[{type:'added',doc:document(head)}]});
    const source={where:()=>source,onSnapshot:(next:typeof emit)=>{emit=next;return()=>{};},select:(...fields:string[])=>{selected.push(fields);return {get:()=>new Promise(resolve=>{project=resolve;})};}};
    const rawDoc={id,exists:true,ref:{path:'events/'+id},data:()=>({type:'news',title:'source mirror',pending:true}),updateTime:time(100)};
    const raw={collection:(name:string)=>name==='collectors'?source:{doc:()=>rawDoc.ref},getAll:async()=>{reads++;return [rawDoc];}} as unknown as Firestore;
    const row:MarketRow={id,data:{type:'news',title:'Parquet title'},version:time(100)};
    const files={query:async()=>[row],hydrate:async(row:MarketRow)=>row,close:async()=>{}} as unknown as MarketFiles;
    const previous=process.env.K_SERVICE;process.env.K_SERVICE='ifindata-web';let repo:MarketRepository;
    try{repo=new MarketRepository(raw,files,undefined,true);}finally{if(previous===undefined)delete process.env.K_SERVICE;else process.env.K_SERVICE=previous;}
    return {repo,id,head,selected,reads:()=>reads,project:(head:MarketHead,at:number)=>project(snapshot(head,at)),emit:(head:MarketHead,at:number)=>emit(snapshot(head,at))};
}
test('projected heads unblock external reads while preserving live overlays before the full stream arrives',async()=>{
    const f=fixture();
    try{
        const pending=f.repo.heads('events');f.project({...f.head,retained:[]},200);await pending;
        assert(f.selected[0].includes('marketHead.file'));assert(!f.selected[0].includes('marketHead.retained'));
        assert.deepEqual((await f.repo.documents('events',[f.id]))[0].data,{type:'news',title:'Parquet title',pending:true});
        assert.equal(f.reads(),1);
        // The full snapshot can be older than the projected get. Identical
        // metadata still safely supplies its membership without rewinding time.
        f.emit({...f.head,retained:[]},100);f.repo.invalidate('events');
        assert.deepEqual((await f.repo.documents('events',[f.id]))[0].data,{type:'news',title:'Parquet title'});
        assert.equal(f.reads(),1);
        f.emit({...f.head,revision:'new'},300);await f.repo.documents('events',[f.id]);assert.equal(f.reads(),2);
    }finally{await f.repo.close();}
});
test('late projected metadata cannot replace a newer full listener snapshot',async()=>{
    const f=fixture();
    try{
        const pending=f.repo.heads('events');f.emit({...f.head,revision:'new'},300);await pending;
        f.project({...f.head,retained:[]},200);await Promise.resolve();
        assert.equal((await f.repo.heads('events')).get(f.head.shard)?.revision,'new');
        assert.equal((await f.repo.heads('events')).get(f.head.shard)?.retained[0],f.id);
    }finally{await f.repo.close();}
});
test('an older full snapshot with different metadata cannot replace projected file pointers',async()=>{
    const f=fixture();
    try{
        const pending=f.repo.heads('events');f.project({...f.head,revision:'new',retained:[]},200);await pending;
        f.emit({...f.head,retained:[]},100);
        assert.equal((await f.repo.heads('events')).get(f.head.shard)?.revision,'new');
        await f.repo.documents('events',[f.id]);assert.equal(f.reads(),1,'unknown membership must remain conservative');
    }finally{await f.repo.close();}
});
