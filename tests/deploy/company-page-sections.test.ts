import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCompanySection} from '../../src/lib/company-page-sections';

function deferred<T>(){
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
const resolved={id:'US:TEST',path:'/company/test',data:{name:'Test',status:'PUBLISHED',inGraph:{status:'PUBLISHED'}}};

test('confirmed company sections start before relationships finish and do not block another company',async()=>{
  const graph=deferred<{inMap:boolean}>(),section=deferred<string>();
  let reads=0,finished=false;
  const result=loadCompanySection('US:TEST',resolved,graph.promise,()=>{reads++;return section.promise;},'');
  void result.then(()=>{finished=true;});
  assert.equal(reads,1,'do not serialize the independent read behind relationships');
  assert.equal(await loadCompanySection('US:OTHER',undefined,Promise.resolve({inMap:true}),async()=>'other',''),'other');
  section.resolve('data');await Promise.resolve();
  assert.equal(finished,false,'publication still waits for the authoritative graph');
  graph.resolve({inMap:true});assert.equal(await result,'data');
});

test('unconfirmed companies never start speculative section reads',async()=>{
  for(const identity of [undefined,{...resolved,id:'US:OTHER'},
    {...resolved,data:{...resolved.data,status:'DRAFT'}},
    {...resolved,data:{...resolved.data,isDeleted:true}},
    {...resolved,data:{...resolved.data,inGraph:{status:'DRAFT'}}}]){
    const graph=deferred<{inMap:boolean}>();let reads=0;
    const result=loadCompanySection('US:TEST',identity,graph.promise,async()=>{reads++;return 'data';},'');
    assert.equal(reads,0);graph.resolve({inMap:false});assert.equal(await result,'');assert.equal(reads,0);
  }
});

test('related-only companies load their section after graph confirmation',async()=>{
  const graph=deferred<{inMap:boolean}>();let reads=0;
  const result=loadCompanySection('US:TEST',undefined,graph.promise,async()=>{reads++;return 'data';},'');
  assert.equal(reads,0);graph.resolve({inMap:true});assert.equal(await result,'data');assert.equal(reads,1);
});

test('a withdrawn or unavailable graph cannot expose an early section',async()=>{
  const graph=deferred<{inMap:boolean}>();
  const result=loadCompanySection('US:TEST',resolved,graph.promise,async()=>'private','');
  graph.resolve({inMap:false});assert.equal(await result,'');
});

test('an early section rejection is observed without waiting for a stalled graph',async()=>{
  const graph=deferred<{inMap:boolean}>();
  const result=loadCompanySection('US:TEST',resolved,graph.promise,async()=>{throw Error('section failed');},'');
  await assert.rejects(result,/section failed/);
  graph.resolve({inMap:true});
});
