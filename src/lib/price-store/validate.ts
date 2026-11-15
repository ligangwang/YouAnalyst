import {isDeepStrictEqual} from 'node:util';
import {PriceStore,readHead,ROOT} from './storage';
import {readSqlitePriceSource} from './sqlite-import';
import type {Step} from './query';

/** Query-level parity against the original GCS snapshots, never Firestore. */
export async function validatePrices(store:PriceStore){
 const head=await readHead(store.bucket);
 if(!head.manifest.ready)throw Error('Price store is not ready');
 const [bytes]=await store.bucket.file(`${ROOT}/sqlite-inventory.json`).download();
 const {files}=JSON.parse(bytes.toString()) as {files:Array<{name:string;generation:string;encoding:string;md5:boolean}>};
 const samples=new Set<number>([0,files.length-1]);
 for(let i=0;i<32;i++)samples.add(Math.floor(i*(files.length-1)/31));
 for(const market of ['US','CN_A','FX']){const index=files.findIndex(f=>f.name.startsWith(`price-snapshots/${market}/`));if(index>=0)samples.add(index);}
 let checked=0;const durations:number[]=[];
 for(const index of samples){
  const source=files[index],expected=(await readSqlitePriceSource(store.bucket,source)).sort((a,b)=>a.id<b.id?-1:1);
  if(!expected.length)continue;
  const steps:Step[]=[{method:'where',args:['id','>=',expected[0].id]},{method:'where',args:['id','<=',expected.at(-1)!.id]},{method:'orderBy',args:['id']}];
  const started=performance.now(),actual=await store.query(steps,head);durations.push(Math.round(performance.now()-started));
  if(!isDeepStrictEqual(actual,expected))throw Error(`Price query parity failed: ${source.name}`);
  const descending=await store.query([...steps.slice(0,2),{method:'orderBy',args:['id','desc']},{method:'limit',args:[2]}],head);
  if(!isDeepStrictEqual(descending,expected.slice(-2).reverse()))throw Error('Latest close parity failed');
  const cursor=await store.query([...steps,{method:'startAfter',args:[expected[0].id]},{method:'limit',args:[3]}],head);
  if(!isDeepStrictEqual(cursor,expected.slice(1,4)))throw Error('Price pagination parity failed');
  const fields=['ticker','tradingDate','close','rawClose','adjustedClose','source'];
  const projected=await store.query([...steps,{method:'select',args:fields}],head);
  if(!isDeepStrictEqual(projected,expected.map(row=>({...row,data:Object.fromEntries(fields.filter(k=>Object.hasOwn(row.data,k)).map(k=>[k,row.data[k]]))}))))throw Error('History projection parity failed');
  checked+=expected.length;
 }
 durations.sort((a,b)=>a-b);
 return {status:'verified',partitions:samples.size,rowsChecked:checked,files:head.manifest.files.length,rows:head.manifest.files.reduce((n,f)=>n+f.rows,0),
  queryMedianMs:durations[Math.floor(durations.length/2)],queryMaxMs:durations.at(-1),rssMiB:Math.round(process.memoryUsage().rss/1024/1024),firestoreReads:0};
}
