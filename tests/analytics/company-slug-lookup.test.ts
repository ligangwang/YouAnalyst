import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { lookupCompanyRoute } from '../../src/lib/market-companies/slug-lookup';
function fixture(rows:Record<string,Record<string,unknown>>) {
  const doc=(id:string)=>({id,data:()=>rows[id]});
  return {collection:(name:string)=>{
    assert.equal(name,'companies');
    return {doc:(id:string)=>({get:async()=>doc(id)}),where:(field:string,op:string,value:string)=>({limit:()=>({get:async()=>({docs:Object.keys(rows).filter(id=>op==='array-contains'?(rows[id][field] as string[]|undefined)?.includes(value):rows[id][field]===value).map(doc)})})})};
  }} as unknown as Firestore;
}
test('Micron slug, old ticker slug, and internal ID resolve to one company',async()=>{
  const db=fixture({'US:MU':{name:'Micron',slug:'micron'}});
  for(const path of ['micron','ticker-mu','US:MU','MU']) assert.deepEqual((await lookupCompanyRoute(path,db))?.id,'US:MU');
  assert.equal((await lookupCompanyRoute('ticker-mu',db))?.path,'/company/micron');
});
test('new private and public companies resolve from stored fields outside the generated inventory',async()=>{
  const db=fixture({'ORG:NEW-LAB':{slug:'new-lab',slugAliases:['former-lab']},'US:NEWXYZ':{slug:'new-company'}});
  for(const path of ['new-lab','former-lab']) assert.equal((await lookupCompanyRoute(path,db))?.path,'/company/new-lab');
  assert.equal((await lookupCompanyRoute('new-company',db))?.id,'US:NEWXYZ');
});
test('ambiguous slug ownership, malformed paths, and missing companies do not resolve',async()=>{
  const db=fixture({'US:AAA':{slug:'duplicate'},'US:BBB':{slug:'duplicate'}});
  for(const path of ['duplicate','openabc','../micron','%ZZ']) assert.equal(await lookupCompanyRoute(path,db),null);
});
