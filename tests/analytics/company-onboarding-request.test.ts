import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {companySupportState} from '../../src/lib/instrument-onboarding/search-state';
import {instrumentId,instrumentFromCompany} from '../../src/lib/instruments/model';
import {onboarding} from '../helpers/company-onboarding';
import {onboardingIdentity} from '../../src/lib/instrument-onboarding/model';

test('directory support states distinguish eligibility, queue progress and unavailable listings',()=>{
  const company={name:'Example',status:'DIRECTORY',cik:'123'};
  assert.equal(companySupportState('US:ABC',company),'ELIGIBLE');
  assert.equal(companySupportState('US:ABC',{...company,cik:null}),'CIK_UNMATCHED');
  assert.equal(companySupportState('XSHG:600000',{...company,cik:null}),'ELIGIBLE');
  assert.equal(companySupportState('US:ABC',{...company,listingStatus:'PRIVATE'}),'UNAVAILABLE');
  assert.throws(()=>onboardingIdentity('US:ABC',{...company,listingStatus:'PRIVATE'}),/eligible public listing/);
  assert.throws(()=>onboardingIdentity('US:ABC',{...company,supersededByCompanyId:'US:OTHER'}),/eligible public listing/);
  for(const status of ['SUPPORTED','QUEUED','PROCESSING','BLOCKED'] as const)assert.equal(companySupportState('US:ABC',{...company,onboarding:onboarding()}, {...instrumentFromCompany('US:ABC',company)!,onboarding:onboarding(status)}),status);
  assert.equal(companySupportState('US:ABC',{...company,onboarding:onboarding()}),'ELIGIBLE');
});

test('request endpoint requires a verified registered account before accessing Firestore',async()=>{
  let calls=0;let provider='password';let invalid=false;
  const fixture={verify:async()=>{if(invalid)throw Error('invalid');return {uid:'registered',firebase:{sign_in_provider:provider}};},db:()=>{calls++;return {};},enqueue:async(_db:unknown,_id:string,uid:string,listing:string)=>{assert.equal(uid,'registered');assert.equal(listing,'US:ABC');return {status:'QUEUED'};}};
  const bundle=await build({entryPoints:['src/app/api/instrument-onboarding/requests/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'registered-fixture',setup(builder){
    builder.onLoad({filter:/[\\/]firebase[\\/]admin\.ts$/},()=>({contents:'export const verifyIdToken=fixture.verify;export const getAdminFirestore=fixture.db;',loader:'js'}));
    builder.onLoad({filter:/[\\/]instrument-onboarding[\\/]queue\.ts$/},()=>({contents:'export const requestInstrumentOnboarding=fixture.enqueue;',loader:'js'}));
  }}]});
  const testModule={exports:{} as {POST:(r:Request&{nextUrl:URL})=>Promise<Response>}};
  new Function('fixture','require','module',bundle.outputFiles[0].text)(fixture,createRequire(import.meta.url),testModule);
  const send=async(token?:string,origin='https://example.com')=>testModule.exports.POST(Object.assign(new Request('https://example.com/api/instrument-onboarding/requests',{method:'POST',headers:{origin,...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({instrumentId:instrumentId('US:ABC'),listingId:'US:ABC',requestedByUid:'spoofed-user',requestedAt:'2000-01-01T00:00:00Z'})}),{nextUrl:new URL('https://example.com/api/instrument-onboarding/requests')}));
  assert.equal((await send()).status,401);assert.equal(calls,0);
  invalid=true;assert.equal((await send('invalid')).status,401);invalid=false;assert.equal(calls,0);
  provider='anonymous';assert.equal((await send('anonymous')).status,403);assert.equal(calls,0);
  provider='google.com';assert.equal((await send('registered','https://elsewhere.com')).status,403);assert.equal(calls,0);
  const response=await send('registered');assert.equal(response.status,200);assert.equal((await response.json()).status,'QUEUED');assert.equal(calls,1);
});
