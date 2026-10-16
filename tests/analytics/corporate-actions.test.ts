import test from 'node:test';
import assert from 'node:assert/strict';
import {corporateActionTickers,splitHistory,syncCorporateActions} from '../../src/lib/predictions/corporate-actions';

function memoryDb(){
  const documents=new Map<string,Record<string,unknown>>();let failCommit=false;
  const ref=(path:string)=>({id:path.split('/').at(-1),path,get:async()=>snapshot(path)});
  const snapshot=(path:string)=>({id:path.split('/').at(-1)!,ref:ref(path),data:()=>documents.get(path),exists:documents.has(path)});
  const db={collection:(name:string)=>({
    doc:(id:string)=>ref(`${name}/${id}`),
    where:(_field:string,_op:string,ticker:string)=>({
      get:async()=>({docs:[...documents].filter(([path,data])=>path.startsWith(name+'/')&&data.ticker===ticker).map(([path])=>snapshot(path))}),
    }),
  }),
    runTransaction:async(work:(tx:unknown)=>unknown)=>work({get:(r:{get:()=>unknown})=>r.get(),set:(r:{path:string},data:Record<string,unknown>)=>documents.set(r.path,{...documents.get(r.path),...data})}),
    batch:()=>{
      const writes:{ref:{path:string};data:Record<string,unknown>}[]=[];
      return {set:(ref:{path:string},data:Record<string,unknown>)=>writes.push({ref,data}),commit:async()=>{if(failCommit)throw Error('write failed');writes.forEach(({ref,data})=>documents.set(ref.path,{...documents.get(ref.path),...data}));}};
    }};
  return {db:db as never,documents,setFailCommit:(value:boolean)=>{failCommit=value;}};
}
const through='2026-10-16',now=()=>Date.parse('2026-10-16T22:00:00Z');

test('full split history succeeds once, incremental windows overlap, duplicate runs skip, and removed actions cancel',async()=>{
  const {db,documents}=memoryDb();const requests:URL[]=[];
  let rows=[{date:'2021-07-20',split:'4/1'},{date:'2024-06-10',split:'10/1'},{date:'2026-10-01',split:'2/1'}];
  const fetcher=(async(url:URL)=>{requests.push(new URL(url));return Response.json(rows);}) as typeof fetch;
  const input={db,tickers:['NVDA','NVDA'],through,token:'synthetic',fetcher,now};
  const first=await syncCorporateActions(input);
  assert.equal(first.backfilled,1);assert.equal(first.events,3);assert.equal(requests[0].searchParams.has('from'),false);
  assert.equal(requests[0].pathname,'/api/splits/NVDA.US');
  const state=documents.get('collectors/split-history_US_NVDA')!;
  assert.equal(state.historyComplete,true);assert.equal(state.lastSuccessfulThrough,through);
  assert.equal(documents.get('corporate_actions/US_NVDA_split_2024-06-10')?.splitFactor,10);
  const again=await syncCorporateActions(input);assert.equal(again.skipped,1);assert.equal(requests.length,1);
  rows=[{date:'2026-10-02',split:'3/2'}];
  const daily=await syncCorporateActions({...input,through:'2026-10-17'});
  assert.equal(daily.updated,1);assert.equal(requests[1].searchParams.get('from'),'2026-09-16');
  assert.equal(documents.get('corporate_actions/US_NVDA_split_2026-10-01')?.status,'cancelled');
  assert.equal(documents.get('corporate_actions/US_NVDA_split_2026-10-02')?.splitFactor,1.5);
  assert.equal(documents.get('corporate_actions/US_NVDA_split_2024-06-10')?.status,'completed');
});

test('a failed write never completes backfill; retries and new stocks safely backfill, including empty histories',async()=>{
  const {db,documents,setFailCommit}=memoryDb();let requests=0;
  const fetcher=(async(url:URL)=>{requests++;return Response.json(url.pathname.includes('AMD')?[]:[{date:'2024-06-10',split:'10/1'}]);}) as typeof fetch;
  const input={db,tickers:['NVDA'],through,token:'synthetic',fetcher,now};
  setFailCommit(true);
  const failed=await syncCorporateActions(input);assert.equal(failed.failures.length,1);
  assert.notEqual(documents.get('collectors/split-history_US_NVDA')?.historyComplete,true);
  setFailCommit(false);
  const retried=await syncCorporateActions(input);assert.equal(retried.backfilled,1);
  const added=await syncCorporateActions({...input,tickers:['NVDA','AMD']});
  assert.equal(added.skipped,1);assert.equal(added.backfilled,1);assert.equal(requests,3);
  assert.equal(documents.get('collectors/split-history_US_AMD')?.historyComplete,true);
  assert.equal([...documents.keys()].filter(key=>key.startsWith('corporate_actions/')).length,1);
  assert.ok([...documents.keys()].every(key=>key.startsWith('corporate_actions/')||key.startsWith('collectors/')));
});

test('leases, deadlines and invalid provider responses cannot silently complete stocks or expose tokens',async()=>{
  const {db,documents}=memoryDb();
  documents.set('collectors/split-history_US_NVDA',{leaseUntil:now()+60000});
  let requests=0;
  const fetcher=(async()=>{requests++;throw Error('https://eodhd.com?api_token=synthetic-secret');}) as typeof fetch;
  const input={db,tickers:['NVDA','AMD'],through,token:'synthetic-secret',fetcher,now};
  const failed=await syncCorporateActions(input);assert.equal(failed.deferred,1);assert.equal(failed.failures.length,1);assert.equal(requests,1);
  assert.ok(!JSON.stringify(failed).includes('synthetic-secret'));
  assert.notEqual(documents.get('collectors/split-history_US_AMD')?.historyComplete,true);
  assert.equal((await syncCorporateActions({...input,deadline:now()})).deferred,2);
  assert.equal(requests,1);
  await assert.rejects(syncCorporateActions({...input,apiUrl:'https://untrusted.example'}),/Invalid corporate action provider/);
});

test('provider split validation rejects malformed, duplicate, future and out-of-window events',()=>{
  assert.deepEqual(splitHistory([],through),[]);
  assert.equal(splitHistory([{date:'2026-10-01',split:'1/5'}],through)[0].denominator,5);
  for(const value of [null,{},[{date:'2026-02-30',split:'2/1'}],[{date:'2027-01-01',split:'2/1'}],[{date:'2026-10-01',split:'0/1'}],[{date:'2026-10-01',split:'2:1'}],[{date:'2026-10-01',split:'2/1'},{date:'2026-10-01',split:'2/1'}]])assert.throws(()=>splitHistory(value,through));
  assert.throws(()=>splitHistory([{date:'2021-07-20',split:'4/1'}],through,'2026-09-01'));
});

test('coverage paginates all users and includes private watchlist calls, saved names, maps and A-shares without duplicates',async()=>{
  const prefs=Array.from({length:501},(_,i)=>({id:String(i).padStart(4,'0'),data:()=>i===500?{followedCompanyIds:['US:ONLYLAST','ORG:PRIVATE','XSHE:000001'],tickers:['nvda']}:{tickers:['AMD']}}));
  const predictions=[{id:'p',data:()=>({watchlistId:'private-list',ticker:'XYZ'})},{id:'q',data:()=>({watchlistId:'',ticker:'EXCLUDED'})}];
  const pages:string[]=[];
  const db={collection:(name:string)=>{
    const rows=name==='predictions'?predictions:prefs;let after='';
    const query={select:()=>query,orderBy:()=>query,limit:()=>query,startAfter:(id:string)=>{after=id;return query;},get:async()=>{pages.push(name+':'+after);return {docs:rows.filter(row=>row.id>after).slice(0,500)};}};
    return query;
  }};
  assert.deepEqual(await corporateActionTickers(db as never,'US',['NVDA','AMD']),['AMD','NVDA','ONLYLAST','XYZ']);
  assert.ok(pages.includes('industry_map_preferences:0499'));
  assert.deepEqual(await corporateActionTickers(db as never,'CN_A',['XSHG:688981']),['XSHE:000001','XSHG:688981'].sort());
});
