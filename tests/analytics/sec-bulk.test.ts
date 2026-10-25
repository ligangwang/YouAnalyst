import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSecBulkJson,secBulkTarget,type SecBulkReader,type SecBulkSnapshot} from '../../src/lib/fundamentals/sec-bulk';
import {cleanExpiredBulkObjects,type BulkObject} from '../../src/lib/fundamentals/bulk-retention';

const snapshot:SecBulkSnapshot={version:1,id:'2026-10-25-1234567890abcdef',capturedAt:'2026-10-25T10:00:00Z',companyIds:['US:AMD'],ciks:['0000002488']};
const url='https://data.sec.gov/api/xbrl/companyfacts/CIK0000002488.json';
test('bulk JSON reads select one issuer and never replace incremental or filing-document requests',async()=>{
  const reads:string[]=[];
  const reader:SecBulkReader={latest:async()=>snapshot,read:async(s,kind,cik)=>{assert.equal(s.id,snapshot.id);reads.push(`${kind}/${cik}`);return {cik:2488,facts:{}};}};
  const options={now:Date.parse('2026-10-25T12:00:00Z')};
  assert.deepEqual(await readSecBulkJson(reader,url,options),{cik:2488,facts:{}});
  assert.deepEqual(reads,['companyfacts/0000002488']);
  assert.equal(await readSecBulkJson(reader,url,{...options,incremental:true}),null);
  assert.equal(await readSecBulkJson(reader,url,{now:Date.parse('2026-10-28T12:00:00Z')}),null);
  assert.equal(await readSecBulkJson(reader,url.replace('0000002488','0000789019'),options),null);
  assert.equal(secBulkTarget('https://www.sec.gov/Archives/edgar/data/2488/a/report.htm'),null);
  assert.equal(secBulkTarget(url+'?unexpected=1'),null);
  assert.equal(reads.length,1);
});
test('bulk cache rejects cross-issuer JSON and invalid snapshot identities',async()=>{
  const reader:SecBulkReader={latest:async()=>snapshot,read:async()=>({cik:789019})};
  await assert.rejects(readSecBulkJson(reader,url,{now:Date.parse(snapshot.capturedAt)}),/identity mismatch/);
  await assert.rejects(readSecBulkJson({...reader,latest:async()=>({...snapshot,id:'../unsafe'})},url),/Invalid SEC bulk snapshot/);
});

test('seven-day cleanup is bounded and excludes held, active and unrelated storage objects',async()=>{
  const now=Date.parse('2026-10-25T12:00:00Z');
  const object=(name:string,days=8):BulkObject=>({name,generation:'42',timeCreated:new Date(now-days*86400_000).toISOString()});
  const expired=object('eodhd-bulk-eod/US/2026-10-01.json');
  const active=object('eodhd-bulk-eod/SHG/2026-10-01.json');
  const protectedZip=object(`sec-financial-bulk/v1/snapshots/${snapshot.id}/companyfacts.zip`);
  const deleted:BulkObject[]=[];
  await cleanExpiredBulkObjects({now,objects:[expired,active,protectedZip,object('eodhd-bulk-eod/US/2026-10-24.json',1),
    {...object('eodhd-bulk-eod/SHE/2026-10-01.json'),temporaryHold:true},object('sec-document-cache/v1/2488/report.htm'),object('price-history/AMD/2020.json')],
    protectedNames:new Set([protectedZip.name]),stillProtected:async o=>o.name===active.name,removeGeneration:async o=>{deleted.push(o);}});
  assert.deepEqual(deleted,[expired]);assert.equal(deleted[0].generation,'42');
});
