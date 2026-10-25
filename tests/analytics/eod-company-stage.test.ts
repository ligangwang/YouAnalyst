import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Firestore} from 'firebase-admin/firestore';
import {runDailyEodMaintenance,scanEodPredictions,type EodPrice} from '../../src/lib/predictions/eod-prices';

test('a real company stage marks its prediction without reading other symbols or publishing portfolio scores',async t=>{
  const previous=globalThis.__adminApp;
  t.after(()=>{globalThis.__adminApp=previous;});
  t.mock.method(console,'info',()=>{});
  const rows=new Map<string,Record<string,unknown>>([
    ['predictions/a',{ticker:'AMD',userId:'owner',status:'CREATED',visibility:'PUBLIC',direction:'UP',entryTargetDate:'2026-01-02',createdAt:'2026-01-01T00:00:00Z'}],
    ['predictions/b',{ticker:'MSFT',userId:'owner',status:'CREATED',visibility:'PUBLIC',direction:'UP',entryTargetDate:'2026-01-02',createdAt:'2026-01-01T00:00:00Z'}],
    ['users/owner',{stats:{totalScore:123}}],
  ]);
  const queries:{name:string;filters:unknown[][]}[]=[];
  const ref=(path:string)=>({path,id:path.split('/').at(-1)!,firestore:db,
    get:async()=>({id:path.split('/').at(-1)!,ref:ref(path),exists:rows.has(path),data:()=>rows.get(path),get:(key:string)=>rows.get(path)?.[key]}),
    set:async(data:Record<string,unknown>)=>{rows.set(path,{...rows.get(path),...data});},
    create:async(data:Record<string,unknown>)=>{assert.ok(!rows.has(path));rows.set(path,data);},
    update:async(data:Record<string,unknown>)=>{rows.set(path,{...rows.get(path),...data});},
  });
  type Ref=ReturnType<typeof ref>;
  const db={
    collection:(name:string)=>{
      assert.notEqual(name,'user_daily_scores','company work must defer portfolio snapshots');
      const query=(filters:unknown[][]=[])=>( {
        doc:(id:string)=>ref(`${name}/${id}`),where:(...args:unknown[])=>query([...filters,args]),orderBy:()=>query(filters),limit:()=>query(filters),
        startAfter:()=>query(filters),
        get:async()=>{
          queries.push({name,filters});
          assert.ok(!filters.some(f=>f[0]==='userId'),'company work must defer aggregate user analytics');
          const entries=[...rows].filter(([key,value])=>key.startsWith(name+'/')&&filters.every(([field,op,v])=>op==='=='?value[String(field)]===v:op==='in'?(v as unknown[]).includes(value[String(field)]):op==='<'?String(value[String(field)])<String(v):true));
          const docs=await Promise.all(entries.map(([path])=>ref(path).get()));
          return {docs,size:docs.length,empty:!docs.length};
        },
      });return query();
    },
    getAll:async(...refs:Ref[])=>Promise.all(refs.filter(r=>r.path).map(r=>r.get())),
    runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>work({get:(r:Ref)=>r.get(),set:(r:Ref,data:Record<string,unknown>)=>r.set(data),update:(r:Ref,data:Record<string,unknown>)=>r.update(data)}),
  } as unknown as Firestore;
  globalThis.__adminApp={firestore:()=>db} as unknown as NonNullable<typeof globalThis.__adminApp>;
  const price:EodPrice={ticker:'AMD',market:'US',requestedDate:'2026-01-02',tradingDate:'2026-01-02',open:10,high:12,low:9,close:11,volume:100,source:'eodhd-bulk-eod',providerSymbol:'AMD.US',exchange:'US',exchangeTimezone:'America/New_York',micCode:'US',loadedAt:'2026-01-03T00:00:00Z',isFinal:true,previousClose:null,previousTradingDate:null,dailyReturn:null};
  const result=await runDailyEodMaintenance({market:'US',runDate:'2026-01-02',tickers:['AMD'],limit:50},{taskId:'amd-task',price});
  assert.equal(result.marking.opened,1);
  assert.equal(rows.get('predictions/a')?.status,'OPEN');
  assert.equal(rows.get('predictions/b')?.status,'CREATED');
  assert.equal((rows.get('users/owner')?.stats as {totalScore:number}).totalScore,123);
  assert.ok(!rows.has('eod_runs/US_2026-01-02'),'a company cannot mark the market run completed');
  assert.ok(queries.some(q=>q.name==='predictions'&&q.filters.some(f=>f[0]==='ticker'&&f[2]==='AMD')));
  await assert.rejects(runDailyEodMaintenance({market:'US',runDate:'2026-01-02',tickers:['AMD']},{taskId:'wrong',price:{...price,ticker:'MSFT'}}),/Invalid prepared company price/);
  const scan=await scanEodPredictions(db,'2026-01-02',50,['AMD'],'US');
  assert.ok(scan.candidatePredictions.every(p=>p.ticker==='AMD'));
});
