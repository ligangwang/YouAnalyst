import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';

test('directory search includes unthemed companies, exposes public states and retains bounded indexed queries',async()=>{
  const base={name:'Example',symbol:'ABC',symbolLower:'abc',status:'DIRECTORY',market:'US'};
  const records=[
    ['US:ABC',{...base,cik:'123'}],['US:NOCIK',{...base}],
    ['XSHG:600000',{...base,market:'CN_A'}],
    ['US:QUEUED',{...base,onboarding:{status:'QUEUED',blockedReason:'private detail'}}],
    ['US:READY',{...base,onboarding:{status:'SUPPORTED'}}],
    ['US:DELETED',{...base,isDeleted:true}],['US:HIDDEN',{...base,status:'DRAFT'}],
  ] as const;
  const limits:number[]=[];let fullReads=0;
  const query={where:()=>query,limit:(n:number)=>{limits.push(n);return query;},get:async()=>({docs:records.map(([id,data])=>({id,data:()=>data}))})};
  const db={collection:()=>({select:()=>query,get:()=>{fullReads++;throw Error('No collection scans');}})};
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
  assert.deepEqual(Object.fromEntries(items.map((i:{id:string;supportState:string})=>[i.id,i.supportState])),{'US:ABC':'ELIGIBLE','US:NOCIK':'CIK_UNMATCHED','XSHG:600000':'ELIGIBLE','US:QUEUED':'QUEUED','US:READY':'SUPPORTED'});
  assert.equal(JSON.stringify(items).includes('private detail'),false);assert.equal(fullReads,0);assert.deepEqual(limits,[50,50,20]);
});
