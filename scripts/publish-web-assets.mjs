import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {GoogleAuth} from 'google-auth-library';

export const site='youanalyst-web-assets';
export const cacheControl='public,max-age=31536000,immutable';
export const assetPrefix=commit=>`https://${site}.web.app/releases/${commit}`;
export function assetObject(path,bytes,commit){
  assert.match(commit,/^[a-f0-9]{40}$/);
  assert(path&&!path.includes('\\')&&!path.split('/').some(part=>part==='..'||!part),'Unsafe asset path');
  assert(/\.(js|css|json|woff2?|ttf|otf|eot|svg|png|jpe?g|webp|avif|gif|ico)$/.test(path),`Unexpected public asset: ${path}`);
  // Hosting's API hashes the gzip representation, including binary assets.
  const data=gzipSync(bytes,{level:9});
  return {path:`/releases/${commit}/_next/static/${path}`,data,hash:createHash('sha256').update(data).digest('hex'),rawHash:createHash('sha256').update(bytes).digest('hex')};
}
export function mergeAssetManifest(previous,assets){
  const files={...previous};
  for(const asset of assets){
    assert(!files[asset.path]||files[asset.path]===asset.hash,`Immutable asset conflict: ${asset.path}`);
    files[asset.path]=asset.hash;
  }
  return files;
}
export async function deployAssetVersion({assets,api,upload,verifyPublic}){
  const parent=`sites/${site}`;
  const latest=async()=>(await api(`${parent}/releases?pageSize=1`)).releases?.[0];
  const predecessor=await latest(),previous={};
  if(predecessor){
    assert(predecessor.type==='DEPLOY'&&predecessor.version?.status==='FINALIZED','Unexpected CDN predecessor');
    let token;
    do{
      const page=await api(`${predecessor.version.name}/files?status=ACTIVE&pageSize=1000${token?`&pageToken=${encodeURIComponent(token)}`:''}`);
      for(const file of page.files??[]){assert.equal(file.status,'ACTIVE');assert.match(file.hash,/^[a-f0-9]{64}$/);previous[file.path]=file.hash;}
      token=page.nextPageToken;
    }while(token);
  }
  const files=mergeAssetManifest(previous,assets);
  const version=await api(`${parent}/versions`,'POST',{config:{headers:[{glob:'**',headers:{'Cache-Control':cacheControl,'Access-Control-Allow-Origin':'*','Timing-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'}}]}});
  assert(version.name?.startsWith(`${parent}/versions/`),'Invalid CDN version');
  const byHash=new Map(assets.map(asset=>[asset.hash,asset]));
  const entries=Object.entries(files);
  for(let offset=0;offset<entries.length;offset+=1000){
    const populated=await api(`${version.name}:populateFiles`,'POST',{files:Object.fromEntries(entries.slice(offset,offset+1000))});
    assert.equal(populated.uploadUrl,`https://upload-firebasehosting.googleapis.com/upload/${version.name}/files`);
    const required=populated.uploadRequiredHashes??[];let index=0;
    await Promise.all(Array.from({length:4},async()=>{while(index<required.length){const hash=required[index++];const asset=byHash.get(hash);assert(asset,'Retained CDN content unavailable; existing release stays unchanged');await upload(`${populated.uploadUrl}/${hash}`,asset.data);}}));
  }
  const finalized=await api(`${version.name}?update_mask=status`,'PATCH',{status:'FINALIZED'});
  assert.equal(finalized.status,'FINALIZED');
  assert.equal((await latest())?.name,predecessor?.name,'CDN changed concurrently; refusing to drop another release');
  await api(`${parent}/releases?versionName=${encodeURIComponent(version.name)}`,'POST',{});
  let index=0;
  await Promise.all(Array.from({length:4},async()=>{while(index<assets.length)await verifyPublic(assets[index++]);}));
  return {files:assets.length,retainedFiles:Object.keys(previous).length,version:version.name};
}
export async function publishWebAssets({root='.release',commit=process.env.GIT_SHA,request=fetch,client}={}){
  assert.match(commit??'',/^[a-f0-9]{40}$/);
  const manifest=JSON.parse(await readFile(`${root}/manifest.json`,'utf8'));
  assert.equal(manifest.commit,commit);assert.equal(manifest.checked,true);assert.equal(manifest.environment,'production');
  assert.equal(manifest.assetPrefix,assetPrefix(commit),'Production build has no immutable asset origin');
  const configuration=JSON.parse(await readFile(`${root}/app/.next/required-server-files.json`,'utf8'));
  assert.equal(configuration.config.assetPrefix,manifest.assetPrefix,'Packaged asset origin differs from the checked manifest');
  const directory=resolve(root,'app/.next/static'),assets=[];
  async function walk(path){for(const entry of await readdir(path,{withFileTypes:true})){
    assert(!entry.isSymbolicLink(),'Public assets must not contain symlinks');
    const full=resolve(path,entry.name);
    if(entry.isDirectory())await walk(full);else if(!entry.name.endsWith('.map'))assets.push(assetObject(relative(directory,full).split(sep).join('/'),await readFile(full),commit));
  }}
  await walk(directory);assert(assets.length>0,'No browser assets to publish');
  client??=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const headers={'x-goog-user-project':'ifindata-80905'};
  const result=await deployAssetVersion({assets,
    api:async(path,method='GET',data)=>(await client.request({url:`https://firebasehosting.googleapis.com/v1beta1/${path}`,method,data,headers,retry:false})).data,
    upload:async(url,data)=>{await client.request({url,method:'POST',data,headers:{...headers,'Content-Type':'application/octet-stream'},retry:false});},
    verifyPublic:async asset=>{
      const response=await request(`https://${site}.web.app${asset.path}`,{headers:{Origin:'https://youanalyst.com','Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});
      assert.equal(response.status,200,`Public asset unavailable: ${asset.path}`);
      assert.equal(response.headers.get('access-control-allow-origin'),'*','Asset CORS is unavailable');
      assert.equal(response.headers.get('cache-control'),cacheControl);
      assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),asset.rawHash,`Public asset bytes differ: ${asset.path}`);
    },
  });
  console.log(`Published and anonymously verified ${result.files} immutable browser assets; retained ${result.retainedFiles} old paths (${result.version}).`);
  return {...result,assetPrefix:manifest.assetPrefix};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)publishWebAssets().catch(error=>{console.error(error.message);process.exitCode=1;});
