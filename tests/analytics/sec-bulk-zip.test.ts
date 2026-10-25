import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import type {File} from '@google-cloud/storage';
import {crc32,extractSelectedSecZip,zipRangeSource} from '../../src/lib/fundamentals/sec-bulk-zip';

function archive(rows:{name:string;body:string}[],zip64=false){
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const row of rows){
    const name=Buffer.from(row.name),body=Buffer.from(row.body),crc=crc32(body),header=Buffer.alloc(30),index=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);header.writeUInt32LE(body.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(name.length,26);
    index.writeUInt32LE(0x02014b50);index.writeUInt16LE(20,4);index.writeUInt16LE(20,6);index.writeUInt32LE(crc,16);index.writeUInt32LE(body.length,20);index.writeUInt32LE(body.length,24);index.writeUInt16LE(name.length,28);index.writeUInt32LE(offset,42);
    local.push(header,name,body);central.push(index,name);offset+=header.length+name.length+body.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22),extra:Buffer[]=[];
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(zip64?65535:rows.length,8);end.writeUInt16LE(zip64?65535:rows.length,10);end.writeUInt32LE(zip64?0xffffffff:directory.length,12);end.writeUInt32LE(zip64?0xffffffff:offset,16);
  if(zip64){const record=Buffer.alloc(56),locator=Buffer.alloc(20);record.writeUInt32LE(0x06064b50);record.writeBigUInt64LE(BigInt(44),4);record.writeUInt16LE(45,12);record.writeUInt16LE(45,14);record.writeBigUInt64LE(BigInt(rows.length),24);record.writeBigUInt64LE(BigInt(rows.length),32);record.writeBigUInt64LE(BigInt(directory.length),40);record.writeBigUInt64LE(BigInt(offset),48);locator.writeUInt32LE(0x07064b50);locator.writeBigUInt64LE(BigInt(offset+directory.length),8);locator.writeUInt32LE(1,16);extra.push(record,locator);}
  return Buffer.concat([...local,directory,...extra,end]);
}
function file(bytes:Buffer){
  let requests=0;
  return {value:{createReadStream:({start,end}:{start:number;end:number})=>{requests++;return Readable.from([bytes.subarray(start,end+1)]);}} as unknown as File,requests:()=>requests};
}
test('ZIP range headers reuse bounded pages rather than one GCS request per header',async()=>{
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
  const bytes=Buffer.alloc(2*1024*1024,7),f=file(bytes),range=zipRangeSource(f.value,bytes.length);
  for(let i=0;i<100;i++){const chunks=[];for await(const c of range(i*46,i*46+46))chunks.push(c);assert.equal(Buffer.concat(chunks).length,46);}
  assert.equal(f.requests(),1);assert.throws(()=>range(0,bytes.length+1),/Invalid SEC ZIP range/);
});
test('ZIP64 extraction writes only selected issuers and validates byte count and CRC',async()=>{
  const bytes=archive([{name:'CIK0000002488.json',body:'{"cik":2488}'},{name:'CIK0000789019.json',body:'{"cik":789019}'}],true);
  const saved:string[]=[],f=file(bytes);
  const result=await extractSelectedSecZip({file:f.value,size:bytes.length,ciks:new Set(['0000002488']),signal:new AbortController().signal,minEntries:1,save:async(cik,body)=>{saved.push(cik);assert.equal(JSON.parse(body.toString()).cik,2488);}});
  assert.deepEqual(saved,['0000002488']);assert.equal(result.entries,2);assert.deepEqual(result.missing,[]);
  const corrupt=Buffer.from(bytes);corrupt[30+Buffer.byteLength('CIK0000002488.json')+8]^=1;
  await assert.rejects(extractSelectedSecZip({file:file(corrupt).value,size:corrupt.length,ciks:new Set(['0000002488']),signal:new AbortController().signal,minEntries:1,save:async()=>{throw Error('corrupt content must not be saved');}}),/integrity mismatch/);
});
test('unsafe paths, duplicate issuer entries and missing coverage never publish selected input',async()=>{
  for(const rows of [[{name:'../CIK0000002488.json',body:'{}'}],[{name:'CIK0000002488.json',body:'{}'},{name:'CIK0000002488.json',body:'{}'}],[{name:'unrelated.json',body:'{}'}]]){
    const bytes=archive(rows);
    await assert.rejects(extractSelectedSecZip({file:file(bytes).value,size:bytes.length,ciks:new Set(['0000002488']),signal:new AbortController().signal,minEntries:1,save:async()=>{}}));
  }
});

