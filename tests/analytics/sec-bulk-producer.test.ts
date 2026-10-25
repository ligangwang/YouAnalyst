import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bulkStorage} from '../helpers/bulk-storage';
import {prepareSecBulkFinancials} from '../../src/lib/fundamentals/sec-bulk-producer';
import {createSecBulkReader} from '../../src/lib/fundamentals/sec-bulk-storage';

test('bulk producer publishes only after both archives and every selected JSON write succeed; retries reuse scope',async()=>{
  const f=bulkStorage(),downloaded:string[]=[],extracted:string[]=[];
  let fail=true;
  const deps={identify:async()=>new Map([['AMD','0000002488'],['MSFT','0000789019']]),
    download:async(bucket:typeof f.value,path:string,kind:'companyfacts'|'submissions')=>{
      downloaded.push(kind);await bucket.file(path).save(Buffer.alloc(22),{metadata:{temporaryHold:true,metadata:{downloadedAt:'2026-10-25T10:00:00Z'}}});return (await bucket.file(path).getMetadata())[0];
    },
    extract:async(options:{file:{name:string};ciks:ReadonlySet<string>;save:(cik:string,bytes:Buffer)=>Promise<void>})=>{
      extracted.push(options.file.name);
      assert.equal(f.rows.get(options.file.name)!.metadata.temporaryHold,true,'active extraction is held');
      if(fail&&options.file.name.endsWith('submissions.zip'))throw Error('incomplete archive');
      for(const cik of options.ciks)await options.save(cik,Buffer.from(JSON.stringify({cik:Number(cik)})));
      return {entries:10_000,selected:[...options.ciks],missing:[]};
    }};
  const options={bucket:f.value,companyIds:['US:AMD'],userAgent:'test',now:Date.parse('2026-10-25T10:00:00Z')};
  await assert.rejects(prepareSecBulkFinancials(options,deps),/incomplete archive/);
  assert.equal(await createSecBulkReader(f.value).latest(),null,'partial company files remain invisible');
  assert.ok([...f.rows.values()].every(row=>!row.metadata.temporaryHold),'stopped producers release holds on invisible staging');
  fail=false;const result=await prepareSecBulkFinancials(options,deps);
  assert.deepEqual(result.snapshot.ciks,['0000002488'],'only interested issuers selected');
  assert.ok([...f.rows].filter(([name])=>name.endsWith('.zip')).every(([,row])=>row.metadata.temporaryHold===false));
  assert.ok(![...f.rows.keys()].some(name=>name.includes('CIK0000789019')));
  const count=downloaded.length;assert.equal((await prepareSecBulkFinancials(options,deps)).reused,true);assert.equal(downloaded.length,count);
  assert.equal(extracted.length,4);
});
