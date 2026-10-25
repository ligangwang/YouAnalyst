import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as admin from 'firebase-admin';
import {getStorage} from 'firebase-admin/storage';
import {fetchEodhdMarketPrices} from '../../src/lib/predictions/eod-prices';

test('exchange files are cached whole, but only requested dated prices leave the reader', async t => {
  const before = {app:globalThis.__adminApp, token:process.env.EODHD_API_TOKEN, bucket:process.env.EODHD_BULK_EOD_BUCKET};
  const app = admin.initializeApp({projectId:'synthetic-eod'}, 'eod-bulk-prices-test');
  globalThis.__adminApp = app;
  process.env.EODHD_API_TOKEN = 'synthetic-token';
  process.env.EODHD_BULK_EOD_BUCKET = 'synthetic-bucket';
  t.after(async () => {
    globalThis.__adminApp = before.app;
    if (before.token === undefined) delete process.env.EODHD_API_TOKEN; else process.env.EODHD_API_TOKEN = before.token;
    if (before.bucket === undefined) delete process.env.EODHD_BULK_EOD_BUCKET; else process.env.EODHD_BULK_EOD_BUCKET = before.bucket;
    await app.delete();
  });
  const files = new Map<string,string>();
  const storage = getStorage(app);
  t.mock.method(storage, 'bucket', () => ({file:(path:string) => ({
    exists:async()=>[files.has(path)], download:async()=>[Buffer.from(files.get(path)!)],
    save:async(value:string)=>{files.set(path,value);},
  })}) as ReturnType<typeof storage.bucket>);
  const date = '2026-09-18', loadedAt = '2026-09-19T00:00:00Z';
  const bar = (code:string, exchange:string, day=date) => ({code,exchange_short_name:exchange,date:day,open:10,high:12,low:9,close:11,adjusted_close:11,volume:100});
  const requests:URL[] = [];
  let bulkFails = false, repairFails = false;
  t.mock.method(globalThis, 'fetch', async (value:URL) => {
    const url = new URL(value); requests.push(url);
    assert.equal(url.searchParams.has('symbols'), false);
    if (url.pathname.startsWith('/api/eod-bulk-last-day/')) {
      if (bulkFails) return new Response('upstream failure', {status:503});
      const exchange = url.pathname.split('/').at(-1)!;
      return Response.json(exchange === 'US' ? [bar('AMD','US'),bar('BRK-B','US'),bar('TSM','US','2026-09-17'),bar('UNINTERESTED','US')]
        : [bar(exchange === 'SHG' ? '600000' : '000001',exchange),bar('999999',exchange)]);
    }
    assert.equal(url.pathname, '/api/eod/TSM.US');
    return Response.json([bar('TSM','US',repairFails ? '2026-09-17' : date)]);
  });

  const us = await fetchEodhdMarketPrices(['AMD','BRK.B','TSM'],date,loadedAt,'US');
  assert.deepEqual(us.failures, []);
  assert.deepEqual(us.prices.map(p=>p.ticker).sort(), ['AMD','BRK.B','TSM']);
  assert.equal(us.prices.find(p=>p.ticker==='BRK.B')?.providerSymbol, 'BRK-B.US');
  assert.equal(us.rawCacheHit, false);
  assert.deepEqual(requests.map(r=>r.pathname), ['/api/eod-bulk-last-day/US','/api/eod/TSM.US']);
  assert.ok(files.get('eodhd-bulk-eod/US/2026-09-18.json')!.includes('UNINTERESTED'));
  requests.length = 0;
  const cached = await fetchEodhdMarketPrices(['AMD'],date,loadedAt,'US');
  assert.equal(cached.rawCacheHit, true);
  assert.equal(cached.prices.length,1);
  assert.equal(requests.length,0);

  const cn = await fetchEodhdMarketPrices(['XSHG:600000','XSHE:000001'],date,loadedAt,'CN_A');
  assert.deepEqual(cn.failures, []);
  assert.deepEqual(requests.map(r=>r.pathname), ['/api/eod-bulk-last-day/SHG','/api/eod-bulk-last-day/SHE']);
  assert.deepEqual(cn.prices.map(p=>[p.ticker,p.market,p.providerSymbol,p.exchange]), [
    ['XSHG:600000','CN_A','600000.SHG','XSHG'],['XSHE:000001','CN_A','000001.SHE','XSHE'],
  ]);
  requests.length = 0;
  repairFails = true;
  const missing = await fetchEodhdMarketPrices(['TSM'],date,loadedAt,'US');
  assert.equal(missing.prices.length,0);
  assert.equal(missing.failures[0].reason,'missing_eodhd_bulk_row');
  bulkFails = true;
  await assert.rejects(fetchEodhdMarketPrices(['AMD'],'2026-09-21',loadedAt,'US'),/HTTP 503/);
  assert.equal(requests.filter(r=>r.pathname==='/api/eod/AMD.US').length,0,'bulk outage must not fan out into every symbol');
});
