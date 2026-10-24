import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {FieldPath} from 'firebase-admin/firestore';
import {withCompanyPageReads} from '../../src/lib/local-cache/company-page-scope';
import {enableCompanyDirectory,companyDirectoryEnabled,registerCompanySource,withLiveCompanyReads} from '../../src/lib/local-cache/company-directory';
import {readCompanyLookup} from '../../src/lib/company-lookup-cache';
import {loadCompanyDocuments} from '../../src/lib/company-document-cache';
import {lookupCompanyRoute} from '../../src/lib/market-companies/slug-lookup';
import {closeLocalCaches} from '../../src/lib/local-cache/watch';

function fixture(){
 const rows=new Map<string,Record<string,unknown>>([
  ['companies/US:SMALL',{slug:'small-example',name:'Small',symbol:'SMALL'}],
  ['company_fundamentals/US:SMALL',{value:{fetchedAt:'2026-10-24',revenue:17}}],
 ]);
 const listeners=new Set<()=>void>();let files=0,opens=0,gets=0;
 function source(collection:string,id?:string,steps:{method:string;args:unknown[]}[]=[]){
  const key=JSON.stringify([collection,id,steps.map(s=>({...s,args:s.args.map(a=>a instanceof FieldPath?'__name__':a)}))]);
  const snapshot=(docId:string)=>({id:docId,ref:source(collection,docId),exists:rows.has(collection+'/'+docId),data:()=>structuredClone(rows.get(collection+'/'+docId)),get:(field:string)=>rows.get(collection+'/'+docId)?.[field]});
  const read=()=>{
   if(id!==undefined)return snapshot(id);
   let ids=[...rows.keys()].filter(k=>k.startsWith(collection+'/')).map(k=>k.slice(collection.length+1));
   for(const step of steps){
    if(step.method==='where'){
     const [field,op,wanted]=step.args;
     ids=ids.filter(id=>{const actual=field instanceof FieldPath?id:rows.get(collection+'/'+id)?.[String(field)];return op==='in'?(wanted as unknown[]).includes(actual):actual===wanted;});
    }
    if(step.method==='limit')ids=ids.slice(0,Number(step.args[0]));
   }
   return {docs:ids.map(snapshot)};
  };
  const value={path:collection+(id?'/'+id:''),id,isEqual:(other:{key:string})=>other.key===key,key,
   doc:(id:string)=>source(collection,id),
   where:(...args:unknown[])=>source(collection,undefined,[...steps,{method:'where',args}]),
   limit:(n:number)=>source(collection,undefined,[...steps,{method:'limit',args:[n]}]),
   get:async()=>{gets++;return read();},
   onSnapshot:(next:(snapshot:unknown)=>void)=>{opens++;const push=()=>next(read());listeners.add(push);queueMicrotask(push);return ()=>{listeners.delete(push);};},
  };
  registerCompanySource(value,id,steps,collection as 'companies');return value;
 }
 const db={collection:(name:string)=>source(name)} as unknown as Firestore;
 enableCompanyDirectory(db,db,{file:async collection=>{files++;return new Map([...rows].filter(([key])=>key.startsWith(collection+'/')).map(([key,value])=>[key.split('/')[1],value]));},sync:false});
 return {db,rows,push:()=>listeners.forEach(push=>push()),counts:()=>({files,opens,gets})};
}

test('cold company routes and financial documents never download whole snapshots, and visitors share push subscriptions',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const read=()=>withCompanyPageReads(async()=>{
  const route=await lookupCompanyRoute('small-example',f.db);
  const [doc]=await loadCompanyDocuments(f.db,'company_fundamentals',['US:SMALL']);
  return {route,value:doc.get('value')};
 });
 const results=await Promise.all(Array.from({length:20},read));
 assert.equal(results[0].route?.id,'US:SMALL');assert.deepEqual(results[0].value,{fetchedAt:'2026-10-24',revenue:17});
 assert.deepEqual(f.counts(),{files:0,opens:2,gets:0});
 f.rows.set('company_fundamentals/US:SMALL',{value:{revenue:23}});f.push();
 assert.deepEqual((await read()).value,{revenue:23});assert.equal(f.counts().opens,2);
 f.rows.set('companies/US:SMALL',{slug:'small-example',isDeleted:true});f.push();
 assert.equal((await read()).route,null);
 assert.equal(f.counts().files,0);
});

test('page cache scope does not change bulk readers, leak after rejection or cache authoritative reads',async t=>{
 t.after(closeLocalCaches);const f=fixture(),ref=f.db.collection('companies').doc('US:SMALL');
 await assert.rejects(withCompanyPageReads(async()=>{assert.equal(companyDirectoryEnabled(f.db),false);assert.equal(companyDirectoryEnabled(f.db,'eod_prices'),true);assert.equal(companyDirectoryEnabled(f.db,'instruments'),true);throw Error('render failure');}),/render failure/);
 assert.equal(companyDirectoryEnabled(f.db),true);
 await withCompanyPageReads(()=>withLiveCompanyReads(()=>readCompanyLookup(f.db,ref)));
 assert.equal(f.counts().gets,1);assert.equal(f.counts().opens,0);
 await readCompanyLookup(f.db,ref);
 assert.equal(f.counts().files,1,'bulk directory policy is unchanged outside company pages');
 const doc=await withCompanyPageReads(()=>readCompanyLookup(f.db,ref));
 assert.equal(doc.get('name'),'Small');assert.equal(f.counts().opens,1);
});
