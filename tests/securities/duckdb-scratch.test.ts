import assert from 'node:assert/strict';
import {test} from 'node:test';
import {access,readdir} from 'node:fs/promises';
import {withDuck} from '../../src/lib/price-store/parquet';

test('DuckDB spills outside the application directory within a fixed scratch budget and cleans up',async()=>{
 const prior=process.env.PRICE_DUCKDB_MEMORY_MB;process.env.PRICE_DUCKDB_MEMORY_MB='64';
 let scratch='';
 try{
  await withDuck(async db=>{
   const rows=(await db.runAndReadAll("SELECT current_setting('temp_directory'),current_setting('max_temp_directory_size')")).getRows();
   scratch=String(rows[0][0]);assert.match(scratch,/youanalyst-duck-/);assert.equal(rows[0][1],'244.1 MiB');
   await db.run("CREATE TABLE spill AS SELECT range AS id,repeat(md5(range::VARCHAR),4) AS payload FROM range(1000000)");
   assert.ok((await readdir(scratch)).length>0,'query must exercise spilling');
   assert.equal((await db.runAndReadAll('SELECT count(*) FROM spill')).getRows()[0][0],1000000n);
  });
  await assert.rejects(access(scratch));
  await assert.rejects(withDuck(async db=>{
   scratch=String((await db.runAndReadAll("SELECT current_setting('temp_directory')")).getRows()[0][0]);
   throw Error('injected query failure');
  }),/injected query failure/);
  await assert.rejects(access(scratch));
 }finally{if(prior===undefined)delete process.env.PRICE_DUCKDB_MEMORY_MB;else process.env.PRICE_DUCKDB_MEMORY_MB=prior;}
});
