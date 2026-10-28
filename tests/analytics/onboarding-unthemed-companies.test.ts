import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {listSupportedUnthemedCompanies} from '../../src/lib/instrument-onboarding/unthemed-companies';

test('company filter includes admission without a request, excludes themed/legacy/deleted issuers, and pages across sparse matches',async()=>{
 const companies=Array.from({length:145},(_,i)=>({id:`US:C${String(i).padStart(3,'0')}`,data:()=>({name:`Company ${i}`,status:'DIRECTORY',onboarding:{status:'SUPPORTED'},...(i<110?{themeMemberships:{robotics:{status:'PUBLISHED'}}}:{})})}));
 companies.push({id:'US:LEGACY',data:()=>({name:'Legacy',status:'PUBLISHED',onboarding:{status:'SUPPORTED'},inGraph:{status:'PUBLISHED'}})} as typeof companies[number]);
 companies.push({id:'US:RETIRED',data:()=>({name:'Retired',status:'DIRECTORY',onboarding:{status:'SUPPORTED'},isDeleted:true})} as typeof companies[number]);
 const db={collection:(name:string)=>{
  assert.notEqual(name,'instrument_onboarding_requests');let after='',size=0,id='';
  const query={where:(field:string,_op:string,value:string)=>{if(name==='companies'){assert.equal(field,'onboarding.status');assert.equal(value,'SUPPORTED');}else{id=value;assert.equal(field,'companyId');}return query;},orderBy:()=>query,limit:(n:number)=>{size=n;return query;},startAfter:(value:string)=>{after=value;return query;},get:async()=>({docs:name==='companies'?companies.filter(row=>row.id>after).slice(0,size):id==='US:C110'?[{id:'INS_test',get:(field:string)=>field==='symbol'?'C110':field==='onboarding'?{status:'PROCESSING'}:false}]:[]})};return query;
 }} as unknown as Firestore;
 const first=await listSupportedUnthemedCompanies(db);assert.equal(first.companies.length,25);assert.equal(first.companies[0].id,'US:C110');assert.equal(first.companies[0].instruments[0].status,'PROCESSING');assert(first.companies.some(row=>!row.instruments.length));assert(first.nextCursor);
 const rest=await listSupportedUnthemedCompanies(db,first.nextCursor!);assert.equal(rest.companies.length,10);assert.equal(rest.nextCursor,null);
 assert.equal(new Set([...first.companies,...rest.companies].map(row=>row.id)).size,35);
});
