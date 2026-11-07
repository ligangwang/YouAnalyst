import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {assetObject,mergeAssetManifest,deployAssetVersion,assetPrefix,site} from '../../scripts/publish-web-assets.mjs';
const commit='a'.repeat(40);
test('only public build assets get immutable release paths and gzip content hashes',()=>{
 const asset=assetObject('chunks/new.js',Buffer.from('console.log("new")'),commit);
 assert.equal(gunzipSync(asset.data).toString(),'console.log("new")');
 assert.equal(asset.path,`/releases/${commit}/_next/static/chunks/new.js`);assert.match(asset.hash,/^[a-f0-9]{64}$/);
 assert.throws(()=>assetObject('../server.js',Buffer.from('secret'),commit));
 assert.throws(()=>assetObject('server.env',Buffer.from('secret'),commit));
 assert.throws(()=>assetObject('chunks/app.js',Buffer.from('code'),'mutable'));
 assert.match(assetPrefix(commit),new RegExp(`/releases/${commit}$`));
});
test('new CDN manifests retain every old path and refuse immutable path collisions',()=>{
 const asset=assetObject('chunks/new.js',Buffer.from('new'),commit);
 const old={'/releases/old/app.js':'1'.repeat(64)};
 assert.deepEqual(mergeAssetManifest(old,[asset]),{...old,[asset.path]:asset.hash});
 assert.deepEqual(mergeAssetManifest({[asset.path]:asset.hash},[asset]),{[asset.path]:asset.hash});
 assert.throws(()=>mergeAssetManifest({[asset.path]:'2'.repeat(64)},[asset]),/Immutable asset conflict/);
});
function fixture({uploadFailure=false,concurrent=false,missingOld=false,publicFailure=false}={}){
 const calls:{path:string;data?:unknown}[]=[],asset=assetObject('chunks/new.js',Buffer.from('new'),commit);
 let released=false,uploads=0,reads=0,verified=0;
 const dependencies={assets:[asset],api:async(path:string,method?:string,data?:unknown)=>{
  calls.push({path,data});
  if(path.includes('/releases?pageSize'))return {releases:[{name:++reads>1&&concurrent?'raced':'old-release',type:'DEPLOY',version:{name:'sites/youanalyst-web-assets/versions/old',status:'FINALIZED'}}]};
  if(path.includes('/files?'))return {files:[{path:'/releases/old/app.js',hash:'1'.repeat(64),status:'ACTIVE'}]};
  if(path.endsWith('/versions'))return {name:`sites/${site}/versions/new`};
  if(path.endsWith(':populateFiles'))return {uploadUrl:`https://upload-firebasehosting.googleapis.com/upload/sites/${site}/versions/new/files`,uploadRequiredHashes:[missingOld?'1'.repeat(64):asset.hash]};
  if(method==='PATCH')return {status:'FINALIZED'};
  if(path.includes('/releases?versionName')){released=true;return {};}
  throw Error(path);
 },upload:async()=>{uploads++;if(uploadFailure)throw Error('upload failed');},verifyPublic:async()=>{verified++;if(publicFailure)throw Error('public check failed');}};
 return {dependencies,calls,state:()=>({released,uploads,verified}),asset};
}
test('CDN release preserves old version files and verifies new public bytes after upload',async()=>{
 const f=fixture();await deployAssetVersion(f.dependencies);
 assert.deepEqual(f.state(),{released:true,uploads:1,verified:1});
 const body=f.calls.find(x=>x.path.endsWith(':populateFiles'))!.data as {files:Record<string,string>};
 assert.equal(body.files['/releases/old/app.js'],'1'.repeat(64));assert.equal(body.files[f.asset.path],f.asset.hash);
});
test('failed uploads, missing retained content, and concurrent CDN updates prevent activation',async()=>{
 for(const options of [{uploadFailure:true},{missingOld:true},{concurrent:true}]){
  const f=fixture(options);await assert.rejects(deployAssetVersion(f.dependencies));assert.equal(f.state().released,false);
 }
 const f=fixture({publicFailure:true});await assert.rejects(deployAssetVersion(f.dependencies),/public check failed/);
});
test('production publishes checked assets before candidate build and promotion',()=>{
 const script=readFileSync('scripts/deploy-cloud-run.sh','utf8');
 assert(script.indexOf('node scripts/publish-web-assets.mjs')<script.indexOf('gcloud builds submit'));
 assert(script.indexOf('node scripts/publish-web-assets.mjs')<script.indexOf('node scripts/promote-release.mjs'));
 assert.match(readFileSync('scripts/prepare-release.mjs','utf8'),/assetPrefix: expectedAssetPrefix/);
});
