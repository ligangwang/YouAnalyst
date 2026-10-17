import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {CHANGE_CACHE_COLLECTIONS} from '../../src/lib/change-cache';

test('change endpoint rejects missing/wrong identity and retries failed persistence',async()=>{
 const bundle=await build({entryPoints:['src/app/api/internal/cache-changes/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixtures',setup(builder){
  builder.onResolve({filter:/firebase\/admin$/},()=>({path:'test-admin',external:true}));
 }}]});
 let claims={email:'cache-events@test.iam.gserviceaccount.com',email_verified:true},fail=false,writes=0;
 const db={collection:()=>({doc:()=>({set:async()=>{if(fail)throw Error('offline');writes++;}})})};
 const native=createRequire(import.meta.url),evaluated={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)((name:string)=>{
  if(name==='test-admin')return {getAdminFirestore:()=>db};
  if(name==='google-auth-library')return {OAuth2Client:class{async verifyIdToken(input:{idToken:string;audience:string}){
   assert.equal(input.audience,'https://receiver.run.app');if(input.idToken!=='signed')throw Error('bad signature');return {getPayload:()=>claims};
  }}};
  return native(name);
 },evaluated,evaluated.exports);
 const {POST}=evaluated.exports as typeof import('../../src/app/api/internal/cache-changes/route');
 const oldProject=process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,oldAudience=process.env.CACHE_EVENT_AUDIENCE;
 process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID='test';process.env.CACHE_EVENT_AUDIENCE='https://receiver.run.app';
 const request=(token?:string)=>new Request('https://receiver.run.app/api/internal/cache-changes',{method:'POST',headers:{
  ...(token?{authorization:`Bearer ${token}`} : {}),'ce-id':'id','ce-type':'google.cloud.firestore.document.v1.written',
  'ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-subject':'documents/companies/US:TEST',
 }});
 try{
  assert.equal((await POST(request())).status,401);assert.equal((await POST(request('forged'))).status,401);
  claims={email:'other@test.iam.gserviceaccount.com',email_verified:true};assert.equal((await POST(request('signed'))).status,403);
  assert.equal(writes,0);claims={email:'cache-events@test.iam.gserviceaccount.com',email_verified:true};
  assert.equal((await POST(request('signed'))).status,204);assert.equal(writes,1);
  fail=true;assert.equal((await POST(request('signed'))).status,503);assert.equal(writes,1);
 }finally{
  if(oldProject===undefined)delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;else process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID=oldProject;
  if(oldAudience===undefined)delete process.env.CACHE_EVENT_AUDIENCE;else process.env.CACHE_EVENT_AUDIENCE=oldAudience;
 }
});

test('deployment covers every cache source and rejects a trigger targeting another service',()=>{
 const script=readFileSync('scripts/setup-cache-changes.sh','utf8');
 const collections=script.match(/for collection in (.+); do/)![1].split(' ');
 assert.deepEqual(collections,[...CHANGE_CACHE_COLLECTIONS]);
 assert.match(script,/eventarcpublishing\.googleapis\.com/);
 assert.match(script,/--event-data-content-type application\/protobuf/);
 const trigger={eventDataContentType:'application/protobuf',serviceAccount:'cache-events@test.iam.gserviceaccount.com',destination:{cloudRun:{service:'web',region:'us-central1',path:'/api/internal/cache-changes'}},eventFilters:[
  {attribute:'type',value:'google.cloud.firestore.document.v1.written'},
  {attribute:'database',value:'(default)'},{attribute:'document',value:'companies/{document}',operator:'match-path-pattern'},
 ]};
 const run=()=>spawnSync(process.execPath,['scripts/verify-cache-trigger.mjs'],{input:JSON.stringify(trigger),encoding:'utf8',env:{...process.env,GCP_PROJECT_ID:'test',CACHE_WEB_SERVICE:'web',GCP_REGION:'us-central1',CACHE_SOURCE_COLLECTION:'companies'}});
 assert.equal(run().status,0);
 trigger.eventDataContentType='application/json';assert.notEqual(run().status,0);trigger.eventDataContentType='application/protobuf';trigger.destination.cloudRun.service='other';assert.notEqual(run().status,0);
});
