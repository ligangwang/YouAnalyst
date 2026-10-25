import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {instrumentId} from '../../src/lib/instruments/model';
import {OnboardingBlocked} from '../../src/lib/instrument-onboarding/model';

async function fixture(){
  const bundle=await build({entryPoints:['src/lib/instrument-onboarding/batch-http.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'batch-auth-fixture',setup(builder){
    builder.onLoad({filter:/[\\/]firebase[\\/]admin\.ts$/},()=>({contents:'export const getAdminFirestore=()=>{throw Error("Use injected DB");};',loader:'js'}));
    builder.onLoad({filter:/[\\/]firebase[\\/]auth\.ts$/},()=>({contents:'export const getDecodedUserFromRequest=()=>null;',loader:'js'}));
    builder.onLoad({filter:/[\\/]firebase[\\/]admin-role\.ts$/},()=>({contents:'export const isAdminUser=()=>false;',loader:'js'}));
    builder.onLoad({filter:/[\\/]instrument-onboarding[\\/]queue\.ts$/},()=>({contents:'export const requestInstrumentOnboarding=()=>{throw Error("Use injected enqueue");};',loader:'js'}));
    builder.onLoad({filter:/[\\/]instrument-onboarding[\\/]model\.ts$/},async()=>({contents:`export {OnboardingBlocked,validRequesterUid} from 'batch-model';`,loader:'js'}));
  }}]});
  const testModule={exports:{} as {adminBatchOnboardingResponse:(request:Request&{nextUrl:URL},dependencies:unknown)=>Promise<Response>}};
  const require=createRequire(import.meta.url);
  new Function('require','module',bundle.outputFiles[0].text)((id:string)=>id==='batch-model'?{OnboardingBlocked,validRequesterUid:(uid:unknown)=>typeof uid==='string'&&uid.length>0&&uid.length<=128}:require(id),testModule);
  let signedIn=true,admin=true,provider='password',opens=0,pauses=0;
  const calls:{id:string;uid:string;listing?:string}[]=[];
  const deps={getUser:async()=>signedIn?{uid:'verified-admin',firebase:{sign_in_provider:provider}}:null,isAdmin:async()=>admin,db:()=>{opens++;return {};},pause:async()=>{pauses++;},enqueue:async(_db:unknown,id:string,uid:string,listing?:string)=>{calls.push({id,uid,listing});return {instrumentId:id,companyId:'US:A',status:'QUEUED',created:true};}};
  const url=new URL('https://example.com/api/admin/instrument-onboarding/requests');
  const send=(value:unknown,origin:string|undefined='https://example.com')=>testModule.exports.adminBatchOnboardingResponse(Object.assign(new Request(url,{method:'POST',headers:origin?{origin}:{},body:typeof value==='string'?value:JSON.stringify(value)}),{nextUrl:url}),deps);
  return {deps,calls,send,counts:()=>({opens,pauses}),signedIn:(value:boolean)=>{signedIn=value;},admin:(value:boolean)=>{admin=value;},provider:(value:string)=>{provider=value;}};
}

test('batch API requires registered admin identity before any enqueue or DB access',async()=>{
  const f=await fixture(),body={items:[{instrumentId:instrumentId('US:A')}],userId:'admin',admin:true};
  f.signedIn(false);assert.equal((await f.send(body)).status,401);
  f.signedIn(true);f.admin(false);assert.equal((await f.send(body)).status,403);
  f.admin(true);f.provider('anonymous');assert.equal((await f.send(body)).status,403);
  f.provider('password');assert.equal((await f.send(body,'https://elsewhere.com')).status,403);
  assert.deepEqual(f.calls,[]);assert.equal(f.counts().opens,0);
});

test('batch limits reject malformed, empty, oversized and over-25 batches without writes',async()=>{
  const f=await fixture();
  for(const value of ['{',null,{}, {items:[]},{items:Array.from({length:26},()=>({instrumentId:instrumentId('US:A')}))}])assert.equal((await f.send(value)).status,400);
  assert.equal((await f.send('x'.repeat(16385))).status,413);assert.equal(f.calls.length,0);
});

test('batch attributes every accepted request to verified admin, deduplicates and preserves per-item outcomes',async()=>{
  const f=await fixture(),ids=['A','B','C','D','E'].map(ticker=>instrumentId('US:'+ticker));
  f.deps.enqueue=async(_db,id,uid,listing)=>{
    f.calls.push({id,uid,listing});if(id===ids[4])throw new OnboardingBlocked('CIK not matched');
    return {instrumentId:id,companyId:'US:A',status:id===ids[1]?'PROCESSING':id===ids[2]?'SUPPORTED':id===ids[3]?'BLOCKED':'QUEUED',created:id===ids[0]};
  };
  const response=await f.send({userId:'spoofed',requestedByUid:'spoofed',items:[...ids.map((id,index)=>({instrumentId:id,listingId:'US:'+String.fromCharCode(65+index),requestedByUid:'spoofed'})),{instrumentId:ids[0]}, {instrumentId:'not-an-instrument'}]},undefined);
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.ok,false);
  assert.deepEqual(body.items.map((row:{outcome:string})=>row.outcome),['QUEUED','ALREADY_REQUESTED','ALREADY_SUPPORTED','ALREADY_REQUESTED','REJECTED','ALREADY_REQUESTED','REJECTED']);
  assert.equal(f.calls.length,5);assert(f.calls.every(row=>row.uid==='verified-admin'));assert.equal(f.counts().pauses,4);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
});

test('storage errors return partial results and stop further new requests',async()=>{
  const f=await fixture(),ids=['A','B','C'].map(ticker=>instrumentId('US:'+ticker));
  f.deps.enqueue=async(_db,id,uid,listing)=>{f.calls.push({id,uid,listing});if(id===ids[1])throw Error('private storage diagnostics');return {instrumentId:id,companyId:'US:A',status:'QUEUED',created:true};};
  const response=await f.send({items:[{instrumentId:ids[0]},{instrumentId:ids[1]},{instrumentId:ids[2]},{instrumentId:ids[0]}]});
  assert.equal(response.status,503);const body=await response.json();
  assert.deepEqual(body.items.map((row:{outcome:string})=>row.outcome),['QUEUED','ERROR','DEFERRED','ALREADY_REQUESTED']);assert.equal(f.calls.length,2);
  assert.equal(JSON.stringify(body).includes('private storage diagnostics'),false);
});

test('25-instrument batches are serialized with bounded pauses',async()=>{
  const f=await fixture();const response=await f.send({items:Array.from({length:25},(_,n)=>({instrumentId:instrumentId(`US:A${n}`)}))});
  assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.equal(f.calls.length,25);assert.equal(f.counts().pauses,24);
});
