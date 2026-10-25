import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {instrumentId} from '../../src/lib/instruments/model';
import {listInstrumentOnboarding} from '../../src/lib/instrument-onboarding/admin';
import {createOnboardingRequest} from '../../src/lib/instrument-onboarding/model';
import {instrumentFromCompany} from '../../src/lib/instruments/model';
import type {Firestore} from 'firebase-admin/firestore';
import {listInstrumentRequesters,requesterId} from '../../src/lib/instrument-onboarding/requesters';

test('admin endpoints authorize reads and retries before accessing storage',async()=>{
  const bundle=await build({entryPoints:['src/lib/instrument-onboarding/admin-http.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'admin-auth-fixture',setup(builder){
    builder.onLoad({filter:/[\\/]firebase[\\/]admin\.ts$/},()=>({contents:'export const getAdminFirestore=()=>{throw Error("Use injected DB");};',loader:'js'}));
    builder.onLoad({filter:/[\\/]firebase[\\/]auth\.ts$/},()=>({contents:'export const getDecodedUserFromRequest=()=>null;',loader:'js'}));
    builder.onLoad({filter:/[\\/]firebase[\\/]admin-role\.ts$/},()=>({contents:'export const isAdminUser=()=>false;',loader:'js'}));
  }}]});
  const testModule={exports:{} as {adminOnboardingResponse:(r:Request&{nextUrl:URL},d:unknown)=>Promise<Response>}};
  new Function('require','module',bundle.outputFiles[0].text)(createRequire(import.meta.url),testModule);
  let allowed=false,signedIn=false,reads=0,retries=0,conflict=false,requesterReads=0;
  const dependencies={getUser:async()=>signedIn?{uid:'u'}:null,isAdmin:async()=>allowed,db:()=>({}),list:async()=>{reads++;return {items:[],nextCursor:null};},requesters:async()=>{requesterReads++;return {items:[],nextCursor:null};},retry:async()=>{retries++;if(conflict)throw Error('active');return {status:'QUEUED'};}};
  const url='https://example.com/api/admin/instrument-onboarding';
  const send=async(method='GET',body:unknown={},origin='https://example.com')=>testModule.exports.adminOnboardingResponse(Object.assign(new Request(url,{method,headers:{origin},...(method==='POST'?{body:JSON.stringify(body)}:{})}),{nextUrl:new URL(url)}),dependencies);
  assert.equal((await send()).status,401);signedIn=true;assert.equal((await send()).status,403);assert.equal(reads,0);
  const retry={instrumentId:instrumentId('US:ABC'),step:'prices',updatedAt:'2026-10-25T00:00:00Z'};
  assert.equal((await send('POST',retry)).status,403);assert.equal(retries,0);
  allowed=true;assert.equal((await send()).status,200);assert.equal(reads,1);
  assert.equal((await send('POST',retry,'https://other.com')).status,403);assert.equal(retries,0);
  assert.equal((await send('POST',{...retry,step:'unknown'})).status,400);
  const response=await send('POST',retry);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(retries,1);
  conflict=true;assert.equal((await send('POST',retry)).status,409);
  const requesterUrl=new URL(url+'?instrumentId='+instrumentId('US:ABC'));
  const request=Object.assign(new Request(requesterUrl),{nextUrl:requesterUrl});
  allowed=false;assert.equal((await testModule.exports.adminOnboardingResponse(request,dependencies)).status,403);assert.equal(requesterReads,0);
  allowed=true;assert.equal((await testModule.exports.adminOnboardingResponse(request,dependencies)).status,200);assert.equal(requesterReads,1);
});

test('requester list is bounded, cursor-paginated and returns only each user UID and time',async()=>{
  const rows=Array.from({length:27},(_,n)=>({requestedByUid:`user-${n}`,requestedAt:'2026-10-25T13:00:00Z'})).map(value=>({id:requesterId(value.requestedByUid),data:()=>value})).sort((a,b)=>a.id.localeCompare(b.id));
  let limit=0,cursor='';
  const query={orderBy:()=>query,limit:(n:number)=>{limit=n;return query;},startAfter:(id:string)=>{cursor=id;return query;},get:async()=>({docs:rows.filter(row=>!cursor||row.id>cursor).slice(0,limit)})};
  const db={collection:()=>({doc:()=>({collection:()=>query})})} as unknown as Firestore;
  const first=await listInstrumentRequesters(db,instrumentId('US:ABC'));assert.equal(limit,26);assert.equal(first.items.length,25);assert.equal(first.nextCursor,rows[24].id);
  const last=await listInstrumentRequesters(db,instrumentId('US:ABC'),first.nextCursor!);assert.equal(last.items.length,2);assert.equal(last.nextCursor,null);
  assert.equal(new Set([...first.items,...last.items].map(row=>row.requestedByUid)).size,27);
});

test('admin list pages are bounded and show separate readiness, current errors and safe retry availability',async()=>{
  const company={name:'Issuer',status:'DIRECTORY',cik:'123',onboarding:{status:'SUPPORTED'}};
  const record=instrumentFromCompany('US:ABC',company)!;
  const request={...createOnboardingRequest(instrumentId('US:ABC'),record,company,'requester-one'),status:'BLOCKED',lastError:'prices: Provider unavailable',leaseOwner:'private-owner'};
  let size=0;const ids=Array.from({length:26},(_,i)=>instrumentId(`US:A${i}`)).sort();
  const db={collection:(name:string)=>({doc:(id:string)=>({id,name}),orderBy:()=>({limit:(limit:number)=>{size=limit;return {get:async()=>({docs:ids.map(id=>({id,data:()=>({...request,instrumentId:id})}))})};}})}),getAll:async(...refs:{name:string}[])=>refs.map(ref=>({data:()=>ref.name==='companies'?company:{...record,onboarding:{status:'BLOCKED'}}}))} as unknown as Firestore;
  const page=await listInstrumentOnboarding(db,undefined,Date.now());assert.equal(size,26);assert.equal(page.items.length,25);assert.equal(page.nextCursor,ids[24]);
  assert.equal(page.items[0].companyStatus,'SUPPORTED');assert.equal(page.items[0].instrumentStatus,'BLOCKED');assert.equal(page.items[0].canRetry,true);assert.equal(page.items[0].request.leaseOwner,null);
});
