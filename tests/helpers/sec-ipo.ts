import assert from 'node:assert/strict';
import {FieldValue,type Firestore} from 'firebase-admin/firestore';

export function ipoFixture(){
  const rows=new Map<string,Record<string,unknown>>();let writes=0;
  const apply=(path:string,data:Record<string,unknown>,merge=false)=>{const row=merge?{...rows.get(path)}:{};for(const [key,value] of Object.entries(data)){if(value instanceof FieldValue&&value.isEqual(FieldValue.delete()))delete row[key];else row[key]=value;}rows.set(path,row);writes++;};
  const ref=(path:string)=>({path,id:path.split('/').at(-1)!,get:async()=>snapshot(path),set:async(data:Record<string,unknown>,options?:{merge?:boolean})=>apply(path,data,options?.merge),update:async(data:Record<string,unknown>)=>{assert(rows.has(path));apply(path,data,true);},collection:(key:string)=>collection(`${path}/${key}`)});
  const snapshot=(path:string)=>({ref:ref(path),id:path.split('/').at(-1)!,exists:rows.has(path),data:()=>rows.get(path),get:(key:string)=>rows.get(path)?.[key]});
  type Filter={field:string;op:string;value:unknown};
  const query=(path:string,filters:Filter[]=[],order?:string,limit=Infinity)=>({
    where:(field:string,op:string,value:unknown)=>query(path,[...filters,{field,op,value}],order,limit),orderBy:(key:string)=>query(path,filters,key,limit),limit:(n:number)=>query(path,filters,order,n),
    get:async():Promise<{docs:ReturnType<typeof snapshot>[]}>=>{let docs:ReturnType<typeof snapshot>[]=[...rows.keys()].filter(key=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1).map(snapshot).filter(doc=>filters.every(({field,op,value})=>{const stored=doc.get(field);if(op==='in')return (value as unknown[]).includes(stored);if(op==='<=')return typeof stored==='number'&&stored<=Number(value);return stored===value;}));if(order)docs=docs.sort((a,b)=>Number(a.get(order))-Number(b.get(order)));return {docs:docs.slice(0,limit)};},
  });
  const collection=(path:string)=>({...query(path),doc:(id:string)=>ref(`${path}/${id}`)});
  let tail=Promise.resolve();
  const db={collection,runTransaction:<T>(work:(tx:unknown)=>Promise<T>)=>{
    const result=tail.then(async()=>{const pending:(()=>void)[]=[];const read=async(r:{get:()=>Promise<unknown>})=>{assert.equal(pending.length,0,'Firestore reads must precede writes');return r.get();};
      const value=await work({get:read,getAll:(...refs:{get:()=>Promise<unknown>}[])=>Promise.all(refs.map(read)),create:(r:{path:string},data:Record<string,unknown>)=>{assert(!rows.has(r.path));pending.push(()=>apply(r.path,data));},set:(r:{path:string},data:Record<string,unknown>,options?:{merge?:boolean})=>pending.push(()=>apply(r.path,data,options?.merge)),update:(r:{path:string},data:Record<string,unknown>)=>{assert(rows.has(r.path));pending.push(()=>apply(r.path,data,true));}});
      pending.forEach(write=>write());return value;});tail=result.then(()=>undefined,()=>undefined);return result;
  }} as unknown as Firestore;
  return {db,rows,writes:()=>writes};
}
