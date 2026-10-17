import test from 'node:test';
import assert from 'node:assert/strict';
import {eodWorkOnce, withEodWorkScope, forgetEodWork} from '../../src/lib/predictions/eod-work-scope';
import {loadEodPriceUniverse} from '../../src/lib/predictions/eod-universe';

test('EOD pages share company setup but preserve page-specific prediction tickers', async () => {
  let reads=0;
  const load=async()=>{reads++;return {asOf:'2026-10-17',nodes:[{id:'US:AMD',kind:'COMPANY' as const,order:0}],relationships:[],sources:[]};};
  const page=(ticker:string)=>loadEodPriceUniverse({market:'US',loadPrices:true,manualTickers:[],predictionTickers:[ticker]},load);
  await withEodWorkScope(async()=>{
    const first=await page('NVDA'),second=await page('MSFT');
    assert.equal(reads,1);
    assert(first.requestedTickers.includes('NVDA'));
    assert(second.requestedTickers.includes('MSFT'));
    assert(!second.requestedTickers.includes('NVDA'));
  });
  await withEodWorkScope(()=>page('NVDA'));
  assert.equal(reads,2,'another delivery must reload current inputs');
});

test('failed and incomplete setup retries, concurrent successful work is shared',async()=>{
  await withEodWorkScope(async()=>{
    let calls=0;
    const work=async()=>{calls++;return calls;};
    assert.deepEqual(await Promise.all([eodWorkOnce('same',work),eodWorkOnce('same',work)]),[1,1]);
    await assert.rejects(eodWorkOnce('retry',async()=>{throw Error('write failed');}));
    assert.equal(await eodWorkOnce('retry',async()=>42),42);
    assert.equal(await eodWorkOnce('partial',async()=>false,Boolean),false);
    assert.equal(await eodWorkOnce('partial',async()=>true,Boolean),true);
  });
});

test('concurrent deliveries have separate state and dates have separate work',async()=>{
  let calls=0;
  await Promise.all([1,2].map(()=>withEodWorkScope(async()=>{
    await eodWorkOnce('2026-10-16',async()=>++calls);
    await eodWorkOnce('2026-10-17',async()=>++calls);
  })));
  assert.equal(calls,4);
});


test('writes invalidate affected setup without discarding unrelated work',async()=>{
 let reads=0;
 await withEodWorkScope(async()=>{
  const read=async()=>++reads;
  await eodWorkOnce('previous-close:AMD',read);
  await eodWorkOnce('universe',read);
  forgetEodWork('previous-close:');
  assert.equal(await eodWorkOnce('previous-close:AMD',read),3);
  assert.equal(await eodWorkOnce('universe',read),2);
 });
});
