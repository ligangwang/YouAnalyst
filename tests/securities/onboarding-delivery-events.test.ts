import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {onboardingEventDisposition} from '../../src/lib/instrument-onboarding/delivery-events';
import {createOnboardingSubscriber} from '../../src/lib/instrument-onboarding/subscriber';

const id='INS_'+'a'.repeat(32),name=`projects/test/databases/(default)/documents/instrument_onboarding_requests/${id}`;
const varint=(raw:number)=>{const value:number[]=[];do{const byte=raw%128;raw=Math.floor(raw/128);value.push(byte+(raw?128:0));}while(raw);return Buffer.from(value);};
const field=(tag:number,body:Uint8Array|string)=>{const bytes=typeof body==='string'?Buffer.from(body):body;return Buffer.concat([varint(tag*8+2),varint(bytes.length),bytes]);};
const doc=(status:string,path=name)=>Buffer.concat([field(1,path),field(2,Buffer.concat([field(1,'status'),field(2,field(17,status))]))]);
const event=(status:string,path=name)=>field(1,doc(status,path));

test('recognizes official protobuf and JSON claim/terminal snapshots and still dispatches queued work',()=>{
  for(const status of ['QUEUED','PROCESSING','SUPPORTED','BLOCKED']){
    const expected=status==='QUEUED'?'ready_event':status==='PROCESSING'?'claim_event':'terminal_event';
    assert.equal(onboardingEventDisposition(event(status),'application/protobuf','test',id),expected);
    const body=Buffer.from(JSON.stringify({value:{name,fields:{status:{stringValue:status}}}}));
    assert.equal(onboardingEventDisposition(body,'application/json','test',id),expected);
  }
  assert.equal(onboardingEventDisposition(field(2,doc('PROCESSING')),'application/protobuf','test',id),'deleted_event');
  assert.throws(()=>onboardingEventDisposition(event('SUPPORTED',name+'-other'),'application/protobuf','test',id),/routing/);
});

test('malformed, truncated, empty and unknown data conservatively falls back to live admission',()=>{
  for(const body of [Buffer.alloc(0),Buffer.from([1,2,3]),event('QUEUED').subarray(0,7),Buffer.concat([event('SUPPORTED'),Buffer.from([255])])])assert.equal(onboardingEventDisposition(body,'application/protobuf','test',id),'unknown');
  assert.equal(onboardingEventDisposition(Buffer.from('{bad'),'application/json','test',id),'unknown');
  assert.equal(onboardingEventDisposition(event('SUPPORTED'),'application/unknown','test',id),'unknown');
});

test('claim, terminal and deletion events acknowledge before admission, even while a worker is busy',async()=>{
  let admit=0,process=0,entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const server=createOnboardingSubscriber({project:'test',admit:async()=>{admit++;return 'ready';},process:async()=>{process++;entered();await hold;return {status:'SUPPORTED'};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/events`;
  const headers={'ce-type':'google.cloud.firestore.document.v1.written','ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-specversion':'1.0','ce-id':'queued','ce-subject':`documents/instrument_onboarding_requests/${id}`,'content-type':'application/protobuf'};
  try{
    const first=fetch(url,{method:'POST',headers,body:event('QUEUED')});await started;
    for(const status of ['PROCESSING','SUPPORTED','BLOCKED'])assert.equal((await fetch(url,{method:'POST',headers:{...headers,'ce-id':status},body:event(status)})).status,204);
    assert.equal((await fetch(url,{method:'POST',headers:{...headers,'ce-id':'delete'},body:field(2,doc('PROCESSING'))})).status,204);
    assert.equal(admit,1);assert.equal(process,1);
    release();assert.equal((await first).status,204);
  }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('twenty independent workers can all do useful work without busy delivery retries',async()=>{
  let active=0,peak=0,entered!:()=>void,release!:()=>void;
  const allStarted=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const servers=Array.from({length:20},()=>createOnboardingSubscriber({project:'test',process:async()=>{active++;peak=Math.max(peak,active);if(active===20)entered();await hold;active--;return {status:'SUPPORTED'};}}));
  await Promise.all(servers.map(async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');}));
  const headers={'ce-type':'google.cloud.firestore.document.v1.written','ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-specversion':'1.0','ce-id':'work','ce-subject':`documents/instrument_onboarding_requests/${id}`,'content-type':'application/protobuf'};
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const requests=servers.map(server=>fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/events`,{method:'POST',headers,body:event('QUEUED')}));
    await Promise.race([allStarted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Workers did not all start')),3000);})]);
    assert.equal(peak,20);release();assert((await Promise.all(requests)).every(response=>response.status===204));
  }finally{if(timer)clearTimeout(timer);release();await Promise.all(servers.map(server=>{server.closeAllConnections();return new Promise<void>(resolve=>server.close(()=>resolve()));}));}
});
