import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import seed from '../../data/investment-themes/catalog-v1.json';
import {catalogGraphSectors} from '../../src/lib/company-themes/catalog-graph';
async function fixture(){
 const bundle=await build({entryPoints:['src/lib/company-themes/admin-http.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'theme-admin-fixture',setup(b){
  b.onLoad({filter:/[\\/]firebase[\\/]admin\.ts$/},()=>({contents:'export const getAdminFirestore=()=>{throw Error("Injected DB required")}',loader:'js'}));
  b.onLoad({filter:/[\\/]firebase[\\/]auth\.ts$/},()=>({contents:'export const getDecodedUserFromRequest=async()=>null',loader:'js'}));
  b.onLoad({filter:/[\\/]firebase[\\/]admin-role\.ts$/},()=>({contents:'export const isAdminUser=async()=>false',loader:'js'}));
  b.onLoad({filter:/[\\/]company-themes[\\/]catalog\.ts$/},()=>({contents:`export const loadThemeCatalog=async()=>${JSON.stringify(seed.nodes)}`,loader:'js'}));
 }}]});
 const testModule={exports:{} as {companyThemesResponse:(request:Request&{nextUrl:URL},deps:unknown)=>Promise<Response>}};
 new Function('require','module',bundle.outputFiles[0].text)(createRequire(import.meta.url),testModule);
 let signed=true,admin=true,provider='password',opens=0;
 const row:Record<string,unknown>={name:'Test',status:'DIRECTORY',description:'Existing description',onboarding:{status:'SUPPORTED'}};
 const snapshot={exists:true,data:()=>structuredClone(row),get:(k:string)=>row[k]};
 const db={collection:(name:string)=>{assert.equal(name,'companies');return {doc:()=>({get:async()=>snapshot})};},runTransaction:async(fn:(tx:unknown)=>unknown)=>fn({get:async()=>snapshot,update:(_ref:unknown,fields:Record<string,unknown>)=>Object.assign(row,fields)})};
 const deps={user:async()=>signed?{uid:'admin-uid',firebase:{sign_in_provider:provider}}:null,isAdmin:async()=>admin,db:()=>{opens++;return db;}};
 // Retain real editor read/write adapters while replacing only identity and transport.
 const send=async(method='GET',value?:unknown,origin='https://app.test')=>{const url=new URL('https://app.test/api/admin/company-themes?companyId=US:TEST');const request=Object.assign(new Request(url,{method,headers:{origin},...(method==='GET'?{}:{body:JSON.stringify(value)})}),{nextUrl:url});return testModule.exports.companyThemesResponse(request,deps);};
 return {send,row,signed:(v:boolean)=>{signed=v;},admin:(v:boolean)=>{admin=v;},provider:(v:string)=>{provider=v;},opens:()=>opens};
}
function assignment(theme:string){return {theme,primarySector:catalogGraphSectors(seed.nodes,theme)[0].id,secondaryRoles:[],sources:[{url:'https://example.com/official',title:'Company business',summary:'The company manufactures spacecraft components.'}]};}
test('theme endpoints enforce admin authentication and origin before opening company storage',async()=>{
 const f=await fixture();f.signed(false);assert.equal((await f.send()).status,401);f.signed(true);f.admin(false);assert.equal((await f.send()).status,403);f.admin(true);f.provider('anonymous');assert.equal((await f.send()).status,403);f.provider('password');assert.equal((await f.send('POST',{},'https://evil.test')).status,403);assert.equal(f.opens(),0);
});
test('admins publish corrections with optimistic concurrency without changing support readiness',async()=>{
 const f=await fixture();const read=await f.send();assert.equal(read.status,200);const body=await read.json();
 assert.equal((await f.send('POST',{version:body.version,assignments:[assignment('robotics')]})).status,200);
 assert.deepEqual(f.row.onboarding,{status:'SUPPORTED'});assert.deepEqual(f.row.themeIds,['robotics']);
 assert.equal((await f.send('POST',{version:body.version,assignments:[assignment('space')]})).status,409);
 const current=await(await f.send()).json();assert.equal((await f.send('POST',{version:current.version,assignments:[assignment('space')]})).status,200);assert.deepEqual(f.row.themeIds,['space']);
 assert.equal((f.row.themeMemberships as Record<string,{status:string}>).robotics.status,'WITHDRAWN');
 const next=await(await f.send()).json();assert.equal((await f.send('POST',{version:next.version,assignments:[]})).status,400);
});
test('legacy AI-only company remains selected when another theme is added',async()=>{
 const f=await fixture();f.row.inGraph={status:'PUBLISHED',stageIds:['ai.applications.edge'],sources:[{url:'https://example.com/official',title:'Edge AI'}],memberships:[{summary:'Produces edge AI systems.'}]};
 const body=await(await f.send()).json();assert.equal(body.assignments.length,1);assert.equal(body.assignments[0].theme,'ai');assert.deepEqual(body.assignments[0].aiStageIds,['ai.applications.edge']);
 assert.equal((await f.send('POST',{version:body.version,assignments:[...body.assignments,assignment('robotics')]})).status,200);
 assert.deepEqual((f.row.inGraph as {stageIds:string[]}).stageIds,['ai.applications.edge']);assert.deepEqual(f.row.themeIds,['ai','robotics']);
});
