import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {instrumentId,instrumentFromCompany} from '../../src/lib/instruments/model';
import {onboarding} from '../helpers/company-onboarding';
import type {Firestore} from 'firebase-admin/firestore';
import {enableCompanyDirectory,companyDirectoryEnabled} from '../../src/lib/local-cache/company-directory';

test('directory search includes unthemed companies, exposes public states and retains bounded indexed queries',async()=>{
  const base={name:'Example',symbol:'ABC',symbolLower:'abc',status:'DIRECTORY',market:'US'};
  const records=[
    ['US:ABC',{...base,cik:'123'}],['US:NOCIK',{...base}],
    ['XSHG:600000',{...base,market:'CN_A'}],
    ['US:QUEUED',{...base,cik:'123',onboarding:{status:'QUEUED',blockedReason:'private detail'}}],
    ['US:READY',{...base,cik:'123',onboarding:{status:'SUPPORTED'}}],
    ['US:THEMED',{...base,cik:'456',onboarding:{status:'SUPPORTED'},themeMemberships:{robotics:{status:'PUBLISHED'}}}],
    ['US:PROCESSING',{...base,cik:'123'}],['US:BLOCKED',{...base,cik:'123'}],['US:PRIVATE',{...base,cik:'123',listingStatus:'PRIVATE'}],['US:DELETED',{...base,isDeleted:true}],['US:HIDDEN',{...base,status:'DRAFT'}],
  ] as const;
  const limits:number[]=[];let fullReads=0;let projection:string[]=[];
  const query={where:()=>query,limit:(n:number)=>{limits.push(n);return query;},get:async()=>{
    assert.equal(companyDirectoryEnabled(db as unknown as Firestore),false,'autocomplete must bypass whole company snapshots even on a cold instance');
    assert.equal(companyDirectoryEnabled(db as unknown as Firestore,'instruments'),false,'support-state enrichment must bypass whole instrument snapshots');
    return {docs:records.map(([id,data])=>({id,data:()=>Object.fromEntries(Object.entries(data).filter(([key])=>projection.includes(key)))}))};
  }};
  const db={collection:(name:string)=>({select:(...fields:string[])=>{projection=fields;return query;},doc:(id:string)=>({id,name}),get:()=>{fullReads++;throw Error('No collection scans');}}),getAll:async(...refs:{id:string;name:string}[])=>refs.map(ref=>{const row=records.find(([id])=>instrumentId(id)===ref.id);return {id:ref.id,data:()=>row&&['US:QUEUED','US:PROCESSING','US:BLOCKED','US:READY','US:THEMED'].includes(row[0])?{...instrumentFromCompany(row[0],row[1])!,onboarding:onboarding(row[0]==='US:QUEUED'?'QUEUED':row[0]==='US:PROCESSING'?'PROCESSING':row[0]==='US:BLOCKED'?'BLOCKED':'SUPPORTED')}:undefined};})};
  enableCompanyDirectory(db as unknown as Firestore,db as unknown as Firestore);
  assert.equal(companyDirectoryEnabled(db as unknown as Firestore),true,'fixture has the production bulk cache enabled');
  const bundle=await build({entryPoints:['src/app/api/tickers/search/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'directory-fixture',setup(builder){
    builder.onLoad({filter:/[\\/]firebase[\\/]admin\.ts$/},()=>({contents:'export const getAdminFirestore=()=>db;',loader:'js'}));
    builder.onLoad({filter:/[\\/]company-themes[\\/]service\.ts$/},()=>({contents:'export const loadCollectionUniverse=()=>{throw Error("No covered universe");};',loader:'js'}));
    builder.onLoad({filter:/[\\/]change-cache\.ts$/},()=>({contents:'export const changeCached=()=>{throw Error("No graph cache");};',loader:'js'}));
    builder.onLoad({filter:/[\\/]company-page-scope\.ts$/},()=>({contents:'export const withCompanyPageReads=load=>load();',loader:'js'}));
  }}]});
  const testModule={exports:{} as {GET:(r:{nextUrl:URL})=>Promise<Response>}};
  new Function('db','require','module',bundle.outputFiles[0].text)(db,createRequire(import.meta.url),testModule);
  const response=await testModule.exports.GET({nextUrl:new URL('https://example.com/api/tickers/search?scope=directory&q=abc')});
  assert.equal(response.status,200);const {items}=await response.json();
  assert.deepEqual(Object.fromEntries(items.map((i:{id:string;supportState:string})=>[i.id,i.supportState])),{'US:ABC':'ELIGIBLE','XSHG:600000':'ELIGIBLE','US:READY':'SUPPORTED','US:THEMED':'SUPPORTED'});
  assert.equal(JSON.stringify(items).includes('private detail'),false);assert.equal(fullReads,0);assert.deepEqual(limits,[50,50,20]);
  const limited=await testModule.exports.GET({nextUrl:new URL('https://example.com/api/tickers/search?scope=directory&q=abc&limit=2')});
  assert.equal((await limited.json()).items.length,2,'excluded companies must not consume the result limit');
  assert.equal(items.find((item:{id:string})=>item.id==='US:READY').hasThemes,false);
  assert.equal(items.find((item:{id:string})=>item.id==='US:THEMED').hasThemes,true);
  assert.equal(companyDirectoryEnabled(db as unknown as Firestore),true,'search scope does not disable snapshots for other requests');
  assert.equal(companyDirectoryEnabled(db as unknown as Firestore,'instruments'),true);
});


test('eligible name matches survive fifty higher-ranked CIK-unmatched symbol matches',async()=>{
  const row=(id:string,data:Record<string,unknown>)=>({id,data:()=>({status:'DIRECTORY',market:'US',name:id,symbol:id.slice(3),symbolLower:id.slice(3).toLowerCase(),...data})});
  const unmatched=Array.from({length:50},(_,index)=>row(`US:ABC${index}`,{}));
  const eligible=row('US:VALID',{name:'ABC eligible company',cik:'123'});
  const db={collection:()=>({select(){return this;},doc:(id:string)=>({id}),where:(field:string,op:string)=>{
    const query={where:()=>query,limit:()=>query,get:async()=>({docs:field==='searchPrefixes'?[eligible]:op==='=='?[]:unmatched})};return query;
  }}),getAll:async(...refs:{id:string}[])=>refs.map(ref=>({id:ref.id,data:()=>undefined}))};
  const bundle=await build({entryPoints:['src/app/api/tickers/search/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'bounded-candidates',setup(builder){
    builder.onLoad({filter:/[\\/]firebase[\\/]admin\.ts$/},()=>({contents:'export const getAdminFirestore=()=>db;',loader:'js'}));
  }}]});
  const testModule={exports:{} as {GET:(r:{nextUrl:URL})=>Promise<Response>}};
  new Function('db','require','module',bundle.outputFiles[0].text)(db,createRequire(import.meta.url),testModule);
  const response=await testModule.exports.GET({nextUrl:new URL('https://example.com/api/tickers/search?scope=directory&q=abc&limit=8')});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).items.map((item:{id:string})=>item.id),['US:VALID']);
});
