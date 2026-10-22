import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {Timestamp} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {sqliteSnapshotFiles} from '../../src/lib/entity-snapshots/sqlite-storage';
import {collections,syncCollection,type Source,type Row} from '../../src/lib/entity-snapshots/sync';
function bucketFixture(){
 const objects=new Map<string,{generation:string;bytes:Buffer}>();let sequence=0,fail=false;
 const names:string[]=[];
 const bucket={file:(name:string,options?:{generation:string})=>{
  names.push(name);const selected=objects.get(name);
  return {getMetadata:async()=>{if(!selected)throw Object.assign(Error('missing'),{code:404});return [{generation:selected.generation}];},
   createReadStream:()=>{assert.equal(options?.generation,selected?.generation);return Readable.from(selected!.bytes);}};
 },upload:async(path:string,options:{destination:string;preconditionOpts:{ifGenerationMatch:string}})=>{
  if(fail)throw Error('upload failed');
  const previous=objects.get(options.destination);
  if((previous?.generation??'0')!==options.preconditionOpts.ifGenerationMatch)throw Object.assign(Error('precondition'),{code:412});
  objects.set(options.destination,{generation:String(++sequence),bytes:await readFile(path)});
 }} as unknown as Bucket;
 return {bucket,objects,names,fail:()=>{fail=true;}};
}
for(const collection of collections)test(`${collection}: SQLite-only initial, incremental, delete, restore and restart`,async()=>{
 const fixture=bucketFixture();let files=sqliteSnapshotFiles(fixture.bucket),time=10;
 let changes:Row[]=[{id:'one',data:{name:'First',updatedAt:new Timestamp(9,123)}},{id:'two',data:{name:'Keep',updatedAt:new Timestamp(9,456)}}];
 const boundaries:(number|undefined)[]=[];
 const source:Source={boundary:async()=>new Timestamp(time,0),rows:async(name,since)=>{assert.equal(name,collection);boundaries.push(since?.seconds);return changes;}};
 try{
  assert.equal((await syncCollection(collection,source,files)).initial,true);
  await files.close();files=sqliteSnapshotFiles(fixture.bucket);
  time=20;changes=[{id:'one',data:{name:'Updated',updatedAt:new Timestamp(19,0)}},{id:'three',data:{name:'Added',updatedAt:new Timestamp(19,0)}}];
  await syncCollection(collection,source,files);
  const second=(await files.load(collection)).snapshot!;
  assert.equal(second.watermark.seconds,20);assert.equal(second.rows.find(row=>row.id==='one')!.data.name,'Updated');
  assert.equal(second.rows.find(row=>row.id==='two')!.data.updatedAt.nanoseconds,456);
  time=30;changes=[{id:'one',data:{isDeleted:true,updatedAt:new Timestamp(29,0)}}];
  await syncCollection(collection,source,files);
  assert.equal((await files.load(collection)).snapshot!.rows.some(row=>row.id==='one'),false);
  time=40;changes=[{id:'one',data:{name:'Restored',isDeleted:false,updatedAt:new Timestamp(39,0)}}];
  await syncCollection(collection,source,files);
  assert.equal((await files.load(collection)).snapshot!.rows.find(row=>row.id==='one')!.data.name,'Restored');
  assert.deepEqual(boundaries,[undefined,10,20,30]);
  assert.ok(fixture.names.every(name=>name.endsWith('.sqlite')));
 }finally{await files.close();}
});
test('failed and stale publication preserve the last SQLite watermark',async()=>{
 const fixture=bucketFixture(),a=sqliteSnapshotFiles(fixture.bucket),b=sqliteSnapshotFiles(fixture.bucket);
 const make=(n:number)=>({version:1 as const,collection:'companies' as const,watermark:new Timestamp(n,0),rows:[]});
 try{
  await a.save('companies',make(10),'0');
  const first=await a.load('companies');await b.load('companies');
  await a.save('companies',make(20),first.generation);
  await assert.rejects(b.save('companies',make(30),first.generation),/precondition/);
  fixture.fail();const latest=await a.load('companies');
  await assert.rejects(a.save('companies',make(40),latest.generation),/upload failed/);
  assert.equal((await a.load('companies')).snapshot!.watermark.seconds,20);
 }finally{await a.close();await b.close();}
});
test('corrupt SQLite fails instead of falling back to JSON',async()=>{
 const fixture=bucketFixture();fixture.objects.set('entity-snapshots/companies.sqlite',{generation:'1',bytes:Buffer.from('corrupt')});
 const files=sqliteSnapshotFiles(fixture.bucket);
 try{await assert.rejects(files.load('companies'));assert.ok(fixture.names.every(name=>name.endsWith('.sqlite')));}
 finally{await files.close();}
});
