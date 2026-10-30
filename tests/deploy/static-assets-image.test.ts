import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// Opt in locally; the release verification job enables this on its Docker runner.
test('real Docker copy layers serve old lazy chunks and current assets for both release paths',{skip:process.env.TEST_ASSET_IMAGES!=='1',timeout:180000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'asset-retention-'));
 const tag=`youanalyst-assets-test-${process.pid}`;
 const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const server=`const http=require('http'),fs=require('fs');http.createServer((req,res)=>{try{res.end(fs.readFileSync('.next/static/'+req.url.split('/_next/static/')[1].split('?')[0]));}catch{res.statusCode=404;res.end();}}).listen(8080,'0.0.0.0');`;
 const images:string[]=[],containers:string[]=[];
 try{
  for(const [name,files] of Object.entries({retained:{'old-lazy.js':'old lazy module','shared.js':'old'},previous:{'previous.js':'previous module','shared.js':'previous'},current:{'current.js':'current module','shared.js':'current'}})){
   await mkdir(join(dir,name,'chunks'),{recursive:true});
   for(const [file,value] of Object.entries(files))await writeFile(join(dir,name,'chunks',file),value);
  }
  await mkdir(join(dir,'app/.next/standalone'),{recursive:true});await mkdir(join(dir,'app/public'),{recursive:true});
  await writeFile(join(dir,'app/.next/standalone/server.js'),server);await writeFile(join(dir,'app/server.js'),server);
  await mkdir(join(dir,'app/node_modules/better-sqlite3'),{recursive:true});
  await writeFile(join(dir,'app/node_modules/better-sqlite3/index.js'),`module.exports=class {prepare(){return {get(){return {ready:1}}}} close(){}}`);
  for(const file of ['Dockerfile','Dockerfile.release']){
   const original=await readFile(file,'utf8');
   // Exercise the actual shipping runner stage; replace only expensive compilation
   // stages with tiny assets representing three deployments.
   const runner=original.slice(original.lastIndexOf('FROM '));
   const fixture=`FROM node:20-bookworm-slim AS base\nFROM base AS retained-assets\nCOPY retained /app/.next/static\nFROM base AS previous-assets\nCOPY previous /app/.next/static\nFROM base AS builder\nCOPY app /app\nCOPY current /app/.next/static\nFROM builder AS native\n${runner}`;
   await writeFile(join(dir,'Dockerfile'),fixture);
   const image=`${tag}:${file==='Dockerfile'?'source':'release'}`;images.push(image);
   docker(['build','-q','-t',image,dir]);
   const container=docker(['run','-d','-p','127.0.0.1::8080',image]);containers.push(container);
   let port:string|undefined;
   for(let i=0;i<50&&!port;i++){
    const inspected=JSON.parse(docker(['inspect',container]))[0];
    assert.notEqual(inspected.State.Status,'exited',docker(['logs',container]));
    port=inspected.NetworkSettings.Ports['8080/tcp']?.[0]?.HostPort;
    if(!port)await new Promise(resolve=>setTimeout(resolve,100));
   }
   assert(port,'container port was not published');
   const url=`http://127.0.0.1:${port}/_next/static/chunks/`;
   // Retry only container startup, never a failed asset assertion.
   for(let i=0;i<50;i++){try{await fetch(url+'current.js');break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
   for(const [name,body] of Object.entries({'old-lazy.js':'old lazy module','previous.js':'previous module','current.js':'current module','shared.js':'current'})){
    const response=await fetch(url+name+'?dpl=old');assert.equal(response.status,200,`${file}: ${name}`);assert.equal(await response.text(),body);
   }
   assert.equal((await fetch(url+'missing.js')).status,404);
  }
 }finally{
  for(const container of containers)docker(['rm','-f',container]);
  for(const image of images)docker(['image','rm','-f',image]);
  assert.equal(dirname(resolve(dir)),resolve(tmpdir()));
  await rm(dir,{recursive:true,force:true});
 }
});
