import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Bucket} from '@google-cloud/storage';
import {createSecBulkReader,publishSecBulkSnapshot,saveSecBulkCompany} from '../../src/lib/fundamentals/sec-bulk-storage';
import type {SecBulkSnapshot} from '../../src/lib/fundamentals/sec-bulk';
const snapshot:SecBulkSnapshot={version:1,id:'2026-10-25-1234567890abcdef',capturedAt:'2026-10-25T10:00:00Z',companyIds:['US:AMD'],ciks:['0000002488']};
function bucket(){
  const rows=new Map<string,{bytes:Buffer;generation:string;metadata:Record<string,unknown>}>();let generation=0;
  const value={file:(name:string,options?:{generation:string})=>({name,
    getMetadata:async()=>{const row=rows.get(name);if(!row)throw {code:404};return [{generation:row.generation,size:String(row.bytes.length),metadata:row.metadata.metadata}];},
    download:async()=>{const row=rows.get(name);if(!row||options&&options.generation!==row.generation)throw {code:404};return [row.bytes];},
    save:async(bytes:string|Buffer,settings:{preconditionOpts:{ifGenerationMatch:string|number};metadata:Record<string,unknown>})=>{
      const old=rows.get(name);if(String(settings.preconditionOpts.ifGenerationMatch)!==(old?.generation??'0'))throw {code:412};
      rows.set(name,{bytes:Buffer.from(bytes),generation:String(++generation),metadata:settings.metadata});
    },
  })} as unknown as Bucket;
  return {value,rows};
}
test('GCS bulk reads pin object generations and verify selected issuer content hashes',async()=>{
  const f=bucket(),reader=createSecBulkReader(f.value),body=Buffer.from(JSON.stringify({cik:2488,facts:{value:1}}));
  assert.equal(await reader.latest(),null);
  await saveSecBulkCompany(f.value,snapshot,'companyfacts','0000002488',body);
  await saveSecBulkCompany(f.value,snapshot,'companyfacts','0000002488',body);
  await assert.rejects(saveSecBulkCompany(f.value,snapshot,'companyfacts','0000002488',Buffer.from(JSON.stringify({cik:2488,facts:{value:2}}))),/changed during retry/);
  assert.deepEqual(await reader.read(snapshot,'companyfacts','0000002488'),JSON.parse(body.toString()));
  f.rows.values().next().value!.bytes=Buffer.from('{"cik":2488}');
  await assert.rejects(reader.read(snapshot,'companyfacts','0000002488'),/integrity mismatch/);
});
test('atomic bulk pointer publication rejects stale generations, older snapshots and identity reuse',async()=>{
  const f=bucket();await publishSecBulkSnapshot(f.value,snapshot,0);
  await publishSecBulkSnapshot(f.value,snapshot,0);
  const later={...snapshot,id:'2026-10-26-1234567890abcdef',capturedAt:'2026-10-26T10:00:00Z'};
  await assert.rejects(publishSecBulkSnapshot(f.value,later,0),error=>(error as {code:number}).code===412);
  const pointer=f.rows.get('sec-financial-bulk/v1/latest.json')!;
  await publishSecBulkSnapshot(f.value,later,pointer.generation);
  await assert.rejects(publishSecBulkSnapshot(f.value,snapshot,4),/older SEC bulk/);
  assert.equal((await createSecBulkReader(f.value).latest())!.id,later.id);
});
