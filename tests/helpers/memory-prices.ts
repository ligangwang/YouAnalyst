import {Timestamp} from 'firebase-admin/firestore';
import type {PriceStore,Mutation} from '../../src/lib/price-store/storage';
import {compileQuery,field,type Step} from '../../src/lib/price-store/query';
/** Business-test port only; production Parquet/CAS behavior is covered with actual
 * DuckDB and immutable fake GCS objects in parquet-prices.test.ts. */
export function memoryPrices(rows:Map<string,Record<string,unknown>>,commit?:(changes:Array<{id:string;data:Record<string,unknown>}>)=>Promise<void>){
 let generation=1;
 const store={bucket:{file:()=>({getMetadata:async()=>[{generation:String(generation)}],download:async()=>[Buffer.from(JSON.stringify({version:1,ready:true,files:[]}))]})},
  query:async(steps:Step[])=>{
   const plan=compileQuery(steps);let selected=[...rows].filter(([key])=>key.startsWith('eod_prices/')).map(([key,data])=>({id:key.slice(11),data}));
   for(const step of steps.filter(s=>s.method==='where')){
    const [f,op,wanted]=step.args,name=field(f);
    selected=selected.filter(row=>{const value=name==='id'?row.id:row.data[name];switch(op){case '==':return value===wanted;case 'in':return (wanted as unknown[]).includes(value);case '>=':return String(value)>=String(wanted);case '<=':return String(value)<=String(wanted);case '>':return String(value)>String(wanted);case '<':return String(value)<String(wanted);default:throw Error('Unsupported test price filter');}});
   }
   selected.sort(plan.compare);
   const cursor=steps.find(s=>s.method==='startAfter')?.args[0];if(cursor)selected=selected.slice(selected.findIndex(r=>r.id===cursor)+1);
   selected=selected.filter(r=>r.data.isDeleted!==true).slice(0,plan.limit);
   if(plan.selection)selected=selected.map(row=>({...row,data:Object.fromEntries(plan.selection!.filter(k=>k in row.data).map(k=>[k,row.data[k]]))}));
   return selected;
  },
  mutate:async(changes:Mutation[])=>{
   const output:Array<{id:string;data:Record<string,unknown>}>=[];let created=0,existing=0;
   for(const change of changes){
    if(!change.id)throw Error('Test price reference needs an id');
    const old=rows.get('eod_prices/'+change.id);
    if(change.mode==='missing'&&old){existing++;continue;}
    if(change.mode==='create'&&old)throw Object.assign(Error('exists'),{code:6});
    output.push({id:change.id,data:{...(change.mode==='replace'?{}:old),...change.data,updatedAt:Timestamp.now(),...(change.mode==='delete'?{isDeleted:true}:{})}});if(!old)created++;
   }
   if(commit)await commit(output);else for(const row of output)rows.set('eod_prices/'+row.id,row.data);
   generation++;globalThis.__youAnalystPriceHead=undefined;
   return {created,existing};
  },
 } as unknown as PriceStore;
 globalThis.__youAnalystParquetStore=Promise.resolve(store);globalThis.__youAnalystPriceHead=undefined;
 return store;
}
