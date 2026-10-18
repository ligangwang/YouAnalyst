import test from 'node:test';
import assert from 'node:assert/strict';
import { CentralCache, type Collection, type Source, type Row } from '../../src/lib/central-cache/store';
import { timestampWrite } from '../../src/lib/central-cache/write-timestamps';
import { encode,decode } from '../../src/lib/central-cache/codec';
import { Timestamp } from 'firebase-admin/firestore';
function fixture(){
 const stored:Record<Collection,Row[]>={companies:[{id:'A',data:{themeIds:['ai']}}],company_fundamentals:[{id:'A',data:{marketCap:1}}],company_relationships:[{id:'edge',data:{source:'A',target:'B',status:'PUBLISHED',themeIds:['ai']}}]};
 let now=1,fail=false;const calls:string[]=[];let changes:Row[]=[];
 const source:Source={boundary:async()=>({seconds:now++,nanoseconds:0}),initial:async(c)=>{calls.push(`initial:${c}`);return structuredClone(stored[c]);},changes:async(c)=>{calls.push(`changes:${c}`);if(fail)throw Error('offline');return structuredClone(changes);},documents:async(c,ids)=>{calls.push(`ids:${c}:${ids.join(',')}`);return structuredClone(stored[c].filter(r=>ids.includes(r.id)));}};
 return {cache:new CentralCache(source),source,stored,calls,change:(rows:Row[])=>{changes=rows;},fail:(value:boolean)=>{fail=value;}};
}
test('one warmup, timestamp refresh, failures retain state, indexes track changes',async()=>{
 const f=fixture();await Promise.all([f.cache.warm(),f.cache.warm()]);assert.equal(f.calls.length,3);
 assert.equal(f.cache.relationships({status:'PUBLISHED'}).length,1);
 f.change([{id:'edge',data:{source:'C',target:'D',status:'HIDDEN',themeIds:['space']}}]);
 f.fail(true);await assert.rejects(f.cache.refresh('company_relationships','v1'));assert.equal(f.cache.relationships({status:'PUBLISHED'}).length,1);
 f.fail(false);await f.cache.refresh('company_relationships','v1');assert.equal(f.cache.relationships({status:'PUBLISHED'}).length,0);assert.equal(f.cache.relationships({companyIds:['A']}).length,0);assert.equal(f.cache.relationships({theme:'space'}).length,1);
 const count=f.calls.length;await f.cache.refresh('company_relationships','v1');assert.equal(f.calls.length,count);
 assert.equal(f.cache.relationships({companyIds:['C','D'],exactIds:['edge']}).length,1);
});
test('deletion arriving during query wins; durable tombstone and recreation are applied',async()=>{
 const f=fixture();await f.cache.warm();f.change(f.stored.company_relationships);f.stored.company_relationships=[];
 await f.cache.refresh('company_relationships','delete',['edge']);assert.equal(f.cache.read('company_relationships').length,0);
 f.change([{id:'edge',data:{source:'A',target:'B',status:'PUBLISHED'}}]);await f.cache.refresh('company_relationships','recreate');assert.equal(f.cache.read('company_relationships').length,1);
 f.change([{id:'edge',data:{},deleted:true}]);await f.cache.refresh('company_relationships','tombstone');assert.equal(f.cache.read('company_relationships').length,0);
});
test('enrollment updates fetch only new fundamentals and remove withdrawn companies',async()=>{
 const f=fixture();await f.cache.warm();f.stored.company_fundamentals.push({id:'B',data:{marketCap:2}});f.change([{id:'A',data:{themeIds:[]}},{id:'B',data:{themeIds:['space']}}]);await f.cache.refresh('companies','v1');assert.deepEqual(f.cache.read('company_fundamentals').map(r=>r.id),['B']);assert.ok(f.calls.includes('ids:company_fundamentals:B'));
});
test('stamp object/positional writes and merge masks without mutating caller arguments',()=>{
 const original={marketCap:1};const result=timestampWrite('set','company_fundamentals/A',[original,{mergeFields:['marketCap']}]);assert.deepEqual(original,{marketCap:1});assert.ok((result[0] as Record<string,unknown>).cacheUpdatedAt);assert.deepEqual((result[1] as {mergeFields:string[]}).mergeFields,['marketCap','cacheUpdatedAt']);
 const precondition={lastUpdateTime:new Timestamp(1,0)};const positional=timestampWrite('update','companies/A',['name','A',precondition]);assert.equal(positional[2],'cacheUpdatedAt');assert.equal(positional.at(-1),precondition);
 assert.deepEqual(timestampWrite('delete','companies/A',[]),[]);
});
test('cache wire preserves timestamps, nested arrays, buffers and null values',()=>{
 const data={at:new Timestamp(2,5),rows:[null,{x:Buffer.from('a')}],date:new Date(0)};assert.deepEqual(decode(encode(data)),data);
});

test('company region index tracks updates, withdrawal and deletion without inferring missing regions',async()=>{
 const f=fixture();f.stored.companies=[
  {id:'US:A',data:{themeIds:['ai'],exchange_region:'US'}},
  {id:'CN:B',data:{themeIds:['space'],exchange_region:'CN'}},
  {id:'US:C',data:{themeIds:['robotics']}}
 ];await f.cache.warm();
 assert.deepEqual(f.cache.companies('US').map(r=>r.id),['US:A']);
 assert.deepEqual(f.cache.companies('CN').map(r=>r.id),['CN:B']);
 f.change([{id:'US:A',data:{themeIds:['ai'],exchange_region:'CN'}},{id:'CN:B',data:{themeIds:[],exchange_region:'CN'}}]);
 await f.cache.refresh('companies','v1');
 assert.deepEqual(f.cache.companies('US'),[]);
 assert.deepEqual(f.cache.companies('CN').map(r=>r.id),['US:A']);
 f.change([{id:'US:A',data:{},deleted:true}]);await f.cache.refresh('companies','v2');
 assert.deepEqual(f.cache.companies('CN'),[]);
});

test('operational fundamentals records do not receive data-cache timestamps',()=>{
 const args=[{status:'processing'}];
 assert.equal(timestampWrite('set','company_fundamentals/_batch_123',args),args);
 assert.equal(timestampWrite('update','company_fundamentals/_lock_123',args),args);
 assert.notEqual(timestampWrite('set','company_fundamentals/US:NVDA',args),args);
});
