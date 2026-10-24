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
import {loadCompanyAnnouncementSources} from '../../src/lib/events/company-announcements';
import {loadPeerPrices} from '../../src/lib/peer-comparison/price-cache';

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
     ids=ids.filter(id=>{const actual=field instanceof FieldPath?id:rows.get(collection+'/'+id)?.[String(field)];return op==='in'?(wanted as unknown[]).includes(actual):op==='>='?String(actual)>=String(wanted):op==='<='?String(actual)<=String(wanted):actual===wanted;});
    }
    if(step.method==='orderBy')ids.sort((a,b)=>a.localeCompare(b)*(step.args[1]==='desc'?-1:1));
    if(step.method==='limit')ids=ids.slice(0,Number(step.args[0]));
   }
   return {docs:ids.map(snapshot)};
  };
  const value={path:collection+(id?'/'+id:''),id,isEqual:(other:{key:string})=>other.key===key,key,
   doc:(id:string)=>source(collection,id),
   where:(...args:unknown[])=>source(collection,undefined,[...steps,{method:'where',args}]),
   limit:(n:number)=>source(collection,undefined,[...steps,{method:'limit',args:[n]}]),
   orderBy:(...args:unknown[])=>source(collection,undefined,[...steps,{method:'orderBy',args}]),
   select:(...args:unknown[])=>source(collection,undefined,[...steps,{method:'select',args}]),
   get:async()=>{gets++;return read();},
   onSnapshot:(next:(snapshot:unknown)=>void)=>{opens++;const push=()=>next(read());listeners.add(push);queueMicrotask(push);return ()=>{listeners.delete(push);};},
  };
  registerCompanySource(value,id,steps,collection as 'companies');return value;
 }
 const db={collection:(name:string)=>source(name)} as unknown as Firestore;
 enableCompanyDirectory(db,db,{file:async collection=>{files++;return new Map([...rows].filter(([key])=>key.startsWith(collection+'/')).map(([key,value])=>[key.split('/')[1],value]));},price:{years:async()=>[2026],file:async()=>{files++;throw Error('price partition requested');}},sync:false});
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

test('cold peer prices share a bounded live query without downloading yearly files',async t=>{
 t.after(closeLocalCaches);const f=fixture(),previous=process.env.PRICE_SNAPSHOT_READY;
 process.env.PRICE_SNAPSHOT_READY='1';t.after(()=>{if(previous===undefined)delete process.env.PRICE_SNAPSHOT_READY;else process.env.PRICE_SNAPSHOT_READY=previous;});
 for(let day=1;day<=20;day++)f.rows.set(`eod_prices/US_SMALL_2026-10-${String(day).padStart(2,'0')}`,{close:day});
 f.rows.set('eod_prices/US_OTHER_2026-10-20',{close:999});
 const read=()=>withCompanyPageReads(()=>loadPeerPrices(f.db,'US:SMALL','US','2026-10-19'));
 const results=await Promise.all(Array.from({length:20},read));
 assert.deepEqual(results[0].map(row=>row.close),[19,18,17,16,15,14,13,12,11,10,9,8]);
 assert.deepEqual(f.counts(),{files:0,opens:1,gets:0});
 f.rows.set('eod_prices/US_SMALL_2026-10-19',{close:123});f.push();
 assert.equal((await read())[0].close,123);assert.equal(f.counts().opens,1);
 await assert.rejects(loadPeerPrices(f.db,'US:SMALL','US','2026-10-19'),/price partition requested/);
 assert.equal(f.counts().files,1,'bulk readers retain their yearly partition policy');
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

test('announcement source approval reads only its company, shares the push cache and applies withdrawals',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const source={id:'small-ir',companyId:'US:SMALL',name:'Small IR',url:'https://ir.smallcompany.com/rss.xml',allowedHosts:['ir.smallcompany.com'],pollMs:3600000,status:'PUBLISHED',reviewedAt:'2026-10-06'};
 const company={name:'Small',status:'DIRECTORY',themeMemberships:{ai:{status:'PUBLISHED'}},newsSources:[source]};
 f.rows.set('investment_themes/technology',{status:'PUBLISHED',parentId:null,names:{en:'Technology','zh-CN':'Technology'},order:0});
 f.rows.set('investment_themes/ai',{status:'PUBLISHED',parentId:'technology',names:{en:'AI','zh-CN':'AI'},order:0});
 f.rows.set('companies/US:SMALL',company);
 // An unrelated invalid source cannot block this company's announcements.
 f.rows.set('companies/US:OTHER',{...company,newsSources:[{...source,companyId:'US:OTHER',url:'http://unapproved.invalid'}]});
 const read=()=>loadCompanyAnnouncementSources(f.db,'US:SMALL');
 const results=await Promise.all(Array.from({length:20},read));
 assert.equal(results[0][0]?.id,'small-ir');
 assert.deepEqual(f.counts(),{files:0,opens:1,gets:1});
 f.rows.set('companies/US:SMALL',{...company,newsSources:[{...source,status:'WITHDRAWN'}]});f.push();
 assert.deepEqual(await read(),[]);
 f.rows.set('companies/US:SMALL',{...company,themeMemberships:{ai:{status:'WITHDRAWN'}}});f.push();
 assert.deepEqual(await read(),[]);
 f.rows.set('companies/US:SMALL',{...company,themeMemberships:{retired:{status:'PUBLISHED'}}});f.push();
 assert.deepEqual(await read(),[],'membership in a retired theme cannot authorize a source');
 f.rows.set('companies/US:SMALL',{...company,isDeleted:true});f.push();assert.deepEqual(await read(),[]);
 f.rows.delete('companies/US:SMALL');f.push();assert.deepEqual(await read(),[]);
 assert.deepEqual(f.counts(),{files:0,opens:1,gets:1});
});
