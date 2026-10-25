import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {FieldValue,type Firestore} from 'firebase-admin/firestore';
import type {Auth} from 'firebase-admin/auth';

async function moduleFixture(){
  const bundle=await build({stdin:{contents:"export * from './src/lib/admin-user-roles/service';export * from './src/lib/admin-user-roles/http';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'role-storage-fixture',setup(builder){
    builder.onLoad({filter:/[\\/]firebase[\\/]admin\.ts$/},()=>({contents:'export const getAdminFirestore=()=>{throw Error("Use injected storage");};export const getAdminAuth=getAdminFirestore;',loader:'js'}));
    builder.onLoad({filter:/[\\/]firebase[\\/]auth\.ts$/},()=>({contents:'export const getDecodedUserFromRequest=()=>null;',loader:'js'}));
  }}]});
  const testModule={exports:{} as typeof import('../../src/lib/admin-user-roles/service')&typeof import('../../src/lib/admin-user-roles/http')};
  new Function('require','module',bundle.outputFiles[0].text)(createRequire(import.meta.url),testModule);
  return testModule.exports;
}

function storage(){
  const rows=new Map<string,Record<string,unknown>>([['actor',{role:'admin',nickname:'owner'}],['member',{nickname:'bob',email:'bob@example.com',role:'editor',billing:{plan:'PRO'},notes:'keep'}]]);
  const claims=new Map<string,Record<string,unknown>>(),disabled=new Set<string>(),versions=new Map<string,number>();let writes=0;
  const ref=(id:string)=>({id,get:async()=>snapshot(id)});
  const snapshot=(id:string)=>{const data=rows.get(id),n=versions.get(id)??1;return {id,ref:ref(id),exists:Boolean(data),updateTime:data?{seconds:10,nanoseconds:n}:undefined,data:()=>data};};
  const collection=()=>({doc:ref,where:(field:string,_operator:string,value:unknown)=>({limit:()=>({get:async()=>({docs:[...rows].filter(([,data])=>data[field]===value).map(([id])=>snapshot(id))})})})});
  const db={collection,runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
    const pending:{id:string;patch:Record<string,unknown>}[]=[];
    const value=await work({getAll:async(...refs:{id:string}[])=>refs.map(ref=>snapshot(ref.id)),update:(ref:{id:string},patch:Record<string,unknown>)=>pending.push({id:ref.id,patch})});
    for(const {id,patch} of pending){const next={...rows.get(id)};for(const [key,value] of Object.entries(patch)){if(value instanceof FieldValue&&value.isEqual(FieldValue.delete()))delete next[key];else next[key]=value;}rows.set(id,next);versions.set(id,(versions.get(id)??1)+1);writes++;}return value;
  }} as unknown as Firestore;
  const auth={getUser:async(uid:string)=>{if(!rows.has(uid))throw {code:'auth/user-not-found'};return {uid,email:uid==='member'?'verified-bob@example.com':`${uid}@example.com`,disabled:disabled.has(uid),customClaims:claims.get(uid)??{}};}} as unknown as Pick<Auth,'getUser'>;
  return {db,auth,rows,claims,disabled,writes:()=>writes};
}

test('role lookup supports exact UID/email/nickname and uses verified authentication email',async()=>{
  const api=await moduleFixture(),f=storage(),actor=await api.authorizeUserRoleAdmin(f.db,f.auth,'actor');
  for(const q of ['member','bob@example.com','@bob']){const record=await api.lookupUserRole(f.db,f.auth,actor,q);assert.equal(record.id,'member');assert.equal(record.email,'verified-bob@example.com');assert.equal(record.admin,false);assert.equal(record.version,'10:1');}
  f.rows.set('duplicate',{nickname:'bob'});await assert.rejects(()=>api.lookupUserRole(f.db,f.auth,actor,'@bob'),/Multiple users/);assert.equal(f.writes(),0);
});

test('grant and revoke use existing fields, clear every profile admin variant and preserve other data',async()=>{
  const api=await moduleFixture(),f=storage(),actor=await api.authorizeUserRoleAdmin(f.db,f.auth,'actor');
  await api.changeUserRole(f.db,f.auth,actor,'member',true,'10:1');assert.equal(f.rows.get('member')!.role,'admin');
  f.rows.set('member',{...f.rows.get('member'),admin:true,isAdmin:true,roles:['admin',' ADMIN ','editor']});
  const result=await api.changeUserRole(f.db,f.auth,actor,'member',false,'10:2');assert.equal(result.admin,false);
  const row=f.rows.get('member')!;assert.equal(row.role,undefined);assert.equal(row.admin,undefined);assert.equal(row.isAdmin,undefined);assert.deepEqual(row.roles,['editor']);assert.deepEqual(row.billing,{plan:'PRO'});assert.equal(row.notes,'keep');
});

test('role changes reject self-revocation, stale versions, disabled accounts and claim-managed admins',async()=>{
  const api=await moduleFixture(),f=storage(),actor=await api.authorizeUserRoleAdmin(f.db,f.auth,'actor');
  await assert.rejects(()=>api.changeUserRole(f.db,f.auth,actor,'actor',false,'10:1'),/own admin/);
  await assert.rejects(()=>api.changeUserRole(f.db,f.auth,actor,'member',true,'10:0'),/User changed/);
  f.claims.set('member',{admin:true});await assert.rejects(()=>api.changeUserRole(f.db,f.auth,actor,'member',false,'10:1'),/authentication claims/);
  f.claims.delete('member');f.disabled.add('member');await assert.rejects(()=>api.changeUserRole(f.db,f.auth,actor,'member',true,'10:1'),/disabled/);assert.equal(f.writes(),0);
});

test('fresh actor authority is required and is rechecked inside the profile transaction',async()=>{
  const api=await moduleFixture(),f=storage();await assert.rejects(()=>api.authorizeUserRoleAdmin(f.db,f.auth,'member'),/Forbidden/);
  const actor=await api.authorizeUserRoleAdmin(f.db,f.auth,'actor');f.rows.set('actor',{role:'viewer'});
  await assert.rejects(()=>api.changeUserRole(f.db,f.auth,actor,'member',true,'10:1'),/Forbidden/);assert.equal(f.writes(),0);
  f.claims.set('actor',{role:'admin'});assert.equal((await api.authorizeUserRoleAdmin(f.db,f.auth,'actor')).claimsAdmin,true);
  f.disabled.add('actor');await assert.rejects(()=>api.authorizeUserRoleAdmin(f.db,f.auth,'actor'),/Forbidden/);
});

test('role HTTP endpoint authorizes every lookup/change and enforces request origin and shape',async()=>{
  const api=await moduleFixture();let signedIn=false,allowed=false,lookups=0,changes=0;
  const deps={getUser:async()=>signedIn?{uid:'actor',firebase:{sign_in_provider:'password'}}:null,db:()=>({}),auth:()=>({}),authorize:async()=>{if(!allowed)throw new api.UserRoleError('Forbidden',403);return {uid:'actor',claimsAdmin:false};},lookup:async()=>{lookups++;return {};},change:async()=>{changes++;return {};}};
  const send=async(method='GET',body:unknown={},origin='https://example.com')=>{
    const url=new URL('https://example.com/api/admin/users/role?q=member'),request=Object.assign(new Request(url,{method,headers:{origin},...(method==='PATCH'?{body:JSON.stringify(body)}:{})}),{nextUrl:url});
    return api.userRoleResponse(request as Parameters<typeof api.userRoleResponse>[0],deps as unknown as NonNullable<Parameters<typeof api.userRoleResponse>[1]>);
  };
  assert.equal((await send()).status,401);signedIn=true;assert.equal((await send()).status,403);assert.equal((await send('PATCH',{userId:'member',admin:true,version:'10:1'})).status,403);assert.equal(changes+lookups,0);
  allowed=true;assert.equal((await send()).status,200);assert.equal(lookups,1);
  assert.equal((await send('PATCH',{},'https://other.com')).status,403);assert.equal((await send('PATCH',{userId:'member',admin:'yes',version:'10:1'})).status,400);
  const response=await send('PATCH',{userId:'member',admin:true,version:'10:1'});assert.equal(response.status,200);assert.equal(changes,1);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
