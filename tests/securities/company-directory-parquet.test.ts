import type {Firestore} from 'firebase-admin/firestore';
import type {MarketFiles,MarketHead} from '../../src/lib/market-store/files';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DuckDBInstance} from '@duckdb/node-api';
import {directoryGeneration,directoryTerm} from '../../src/lib/market-store/directory-index';
import {buildDirectoryParts,publishDirectoryIndex} from '../../src/lib/market-store/publish-directory-index';
import {quote} from '../../src/lib/price-store/parquet';

const select={method:'select',args:['name']};
const limit={method:'limit',args:[50]};
const where=(...args:unknown[])=>({method:'where',args});

test('a changed company shard invalidates the index, independent of inventory order',()=>{
    const heads=Array.from({length:256},(_,i)=>({shard:i.toString(16).padStart(2,'0'),revision:'version-a'}));
    const before=directoryGeneration(heads);
    assert.ok(before);
    assert.equal(directoryGeneration([...heads].reverse()),before);
    assert.equal(directoryGeneration(heads.slice(1)),undefined);
    heads[120].revision='version-b';
    assert.notEqual(directoryGeneration(heads),before);
});

test('published search partitions preserve bounds, UTF-8 order and unique IDs',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'test-directory-'));
    const source=join(dir,'stocks.ndjson');
    const rows=Array.from({length:70},(_,i)=>({id:'US:'+String(70-i).padStart(3,'0'),symbolLower:i%2?'nvda':'nvd',searchPrefixes:['英伟达','英伟达']}));
    rows.push({id:'US:UNICODE',symbolLower:'nv😀',searchPrefixes:[]});
    const instance=await DuckDBInstance.create(':memory:');
    const db=await instance.connect();
    try{
        await writeFile(source,rows.map(r=>JSON.stringify(r)).join('\n'));
        const parts=await buildDirectoryParts(source,dir);
        async function query(conditions:ReturnType<typeof where>[]){
            const term=directoryTerm([select,...conditions,limit])!;
            const result=await db.runAndReadAll(`SELECT payload FROM read_parquet(${quote(join(parts,term.part+'.parquet'))}) WHERE field=?`,[term.key]);
            return JSON.parse(String(result.getRows()[0]?.[0]??'[]'));
        }
        assert.deepEqual(await query([where('searchPrefixes','array-contains','英伟达')]),rows.slice(0,70).map(r=>r.id).sort().slice(0,50));
        assert.deepEqual(await query([where('symbolLower','==','nvda')]),rows.filter(r=>r.symbolLower==='nvda').map(r=>r.id).sort());
        assert.deepEqual(await query([where('symbolLower','>=','nv'),where('symbolLower','<=','nv\uf8ff')]),
            rows.slice(0,70).sort((a,b)=>a.symbolLower.localeCompare(b.symbolLower)||a.id.localeCompare(b.id)).slice(0,50).map(r=>r.id));
        assert.deepEqual(await query([where('symbolLower','==','missing')]),[]);
        assert.equal(directoryTerm([select,where('symbolLower','==','nvda'),where('active','==',true),limit]),undefined);
        assert.equal(directoryTerm([select,where('symbolLower','==','nvda'),{method:'offset',args:[1]},limit]),undefined);
    }finally{db.closeSync();instance.closeSync();await rm(dir,{recursive:true,force:true});}
});

test('directory publication skips legacy roots and stops if relocation changes during a shard read',async()=>{
    const mode=(ready:boolean)=>({exists:true,data:()=>({version:1,ready,cleanupAuthorized:false})});
    const heads=Array.from({length:256},(_,i)=>({collection:'companies',shard:i.toString(16).padStart(2,'0'),revision:'test',retained:[],rows:0})) as MarketHead[];
    const notReady={doc:()=>({get:async()=>mode(false)})};
    await publishDirectoryIndex(notReady as unknown as Firestore,{} as MarketFiles,heads);
    let checked=false;
    const raw={doc:()=>({get:async()=>mode(true)}),collection:()=>({doc:()=>({})}),
        runTransaction:async(read:(tx:object)=>Promise<unknown>)=>read({getAll:async()=>{checked=true;return [{get:()=>'test'},mode(false)];}})};
    const files={bucket:{file:()=>({exists:async()=>[false],download:async()=>{throw Object.assign(Error('missing'),{code:404});}})}};
    await publishDirectoryIndex(raw as unknown as Firestore,files as unknown as MarketFiles,heads);
    assert.equal(checked,true);
});
