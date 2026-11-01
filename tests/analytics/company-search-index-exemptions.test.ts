import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
test('index maintenance defers obsolete search exemptions until explicitly enabled',async()=>{
 const config=JSON.parse(readFileSync('firestore.indexes.json','utf8'));
 const bundle=await build({entryPoints:['scripts/firestore/apply-indexes.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
 const realRequire=createRequire(import.meta.url);
 for(const enabled of [false,true]){
  const commands:string[][]=[];
  const fixtureProcess={env:{FIRESTORE_PROJECT_ID:'fixture',FIRESTORE_COLLECTION_GROUPS:'companies',...(enabled?{FIRESTORE_APPLY_FIELD_OVERRIDES:'1'}:{})},cwd:()=>process.cwd(),exitCode:undefined};
  const injected=(name:string)=>name==='node:fs'?{readFileSync:()=>JSON.stringify(config)}:name==='node:child_process'?{spawnSync:(command:string,args:string[])=>{assert.equal(command,'gcloud');commands.push(args);return {status:0,stdout:'',stderr:''};}}:realRequire(name);
  const evaluated={exports:{}};
  new Function('require','module','exports','process','console',bundle.outputFiles[0].text)(injected,evaluated,evaluated.exports,fixtureProcess,{log:()=>{},error:(message:unknown)=>assert.fail(String(message))});
  const composites=commands.filter(command=>command.includes('composite'));
  assert.equal(composites.length,config.indexes.filter((index:{collectionGroup:string})=>index.collectionGroup==='companies').length);
  const fields=commands.filter(command=>command.includes('fields'));
  assert.equal(fields.length,config.fieldOverrides.filter((field:{collectionGroup:string;indexes:unknown[]})=>field.collectionGroup==='companies'&&(enabled||field.indexes.length)).length);
  for(const command of fields){
   assert(command.includes('--collection-group=companies'));assert(!command.includes('searchPrefixes'));assert(!command.includes('symbolLower'));
   if(command.includes('updatedAt')){assert(command.includes('--index=order=ascending'));assert(command.includes('--index=order=descending'));assert(!command.includes('--disable-indexes'));}
   else if(command.includes('inGraph.status')){assert(command.includes('--index=order=ascending'));assert(!command.includes('--disable-indexes'));}
   else {assert(enabled);assert(command.includes('--disable-indexes'));}
  }
 }
});
