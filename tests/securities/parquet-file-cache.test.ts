import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import type {Bucket} from '@google-cloud/storage';
import {PriceStore} from '../../src/lib/price-store/storage';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
test('concurrent first readers share one download and eviction preserves every active pin',async()=>{
 let downloads=0;
 const downloaded=deferred(),held=deferred(),release=deferred();
 const bucket={file:()=>({download:async({destination}:{destination:string})=>{downloads++;await writeFile(destination,'immutable content');downloaded.resolve();}})} as unknown as Bucket;
 const store=new PriceStore(bucket,1);
 try{
  const first=store.local(['same'],async([path])=>{await downloaded.promise;return readFile(path,'utf8');});
  const second=store.local(['same'],async([path])=>{held.resolve();await release.promise;return readFile(path,'utf8');});
  await held.promise;assert.equal(await first,'immutable content');assert.equal(downloads,1);
  await store.local(['another'],async([path])=>assert.equal(await readFile(path,'utf8'),'immutable content'));
  release.resolve();assert.equal(await second,'immutable content');
 }finally{release.resolve();await store.close();}
});
test('overlapping eviction and repeated reloads never unlink a replacement file',async()=>{
 const bucket={file:(name:string)=>({download:async({destination}:{destination:string})=>{await writeFile(destination,name.repeat(32));}})} as unknown as Bucket;
 const store=new PriceStore(bucket,1);
 try{
  for(let round=0;round<30;round++)await Promise.all(Array.from({length:16},(_,i)=>{const name=String(i%3);return store.local([name],async([path])=>{await new Promise(resolve=>setImmediate(resolve));assert.equal(await readFile(path,'utf8'),name.repeat(32));});}));
 }finally{await store.close();}
});
