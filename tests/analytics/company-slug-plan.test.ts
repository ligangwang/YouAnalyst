import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanySlugPlan } from '../../src/lib/market-companies/slug-plan';
import { COMPANY_URL_SLUGS } from '../../src/lib/market-companies/slugs';
import { companyFields } from '../../src/lib/market-companies/model';
test('names cover public, private and Chinese companies while preserving established URLs',()=>{
  const rows = buildCompanySlugPlan([{id:'US:MU',name:'Micron Technology, Inc.'},{id:'ORG:MISTRAL-AI',name:'Mistral AI'},{id:'US:NEW',name:'New Systems Corporation'},{id:'XSHG:600001',name:'中国公司'}]);
  assert.deepEqual(rows.map(row=>row.slug).sort(),['micron','mistral-ai','new-systems','中国公司'].sort());
});
test('same-name companies get deterministic distinct slugs regardless of input order',()=>{
  const rows=[{id:'US:AAA',name:'Example Inc.'},{id:'US:BBB',name:'Example Corporation'}];
  const a=buildCompanySlugPlan(rows), b=buildCompanySlugPlan([...rows].reverse());
  assert.deepEqual(a,b); assert.equal(new Set(a.map(row=>row.slug)).size,2);
});
test('existing canonical URLs remain stable through name changes',()=>{
  assert.equal(buildCompanySlugPlan([{id:'US:AAA',name:'Renamed Company',slug:'original-brand'}])[0].slug,'original-brand');
});
test('duplicate canonical and alias ownership fail before writes',()=>{
  assert.throws(()=>buildCompanySlugPlan([{id:'US:A',name:'A',slug:'same'},{id:'US:B',name:'B',slug:'same'}]),/collision/);
  assert.throws(()=>buildCompanySlugPlan([{id:'US:A',name:'A',slugAliases:['b']},{id:'US:B',name:'B'}]),/alias/);
});
test('missing names block migration instead of exposing an ID as a slug',()=>{
  assert.throws(()=>buildCompanySlugPlan([{id:'US:BAD'}]),/Missing company name/);
});
test('the reviewed URL inventory is unique and never emits ticker-prefixed company names',()=>{
  const slugs=Object.values(COMPANY_URL_SLUGS);
  assert.equal(new Set(slugs).size,slugs.length);
  assert(slugs.length>24_000);
  assert(slugs.every(slug=>!slug.startsWith('ticker-')));
});
test('listing refreshes preserve stored slugs and new company records get readable names',()=>{
  assert.equal(companyFields('US:MU',{name:'Micron renamed',slug:'micron'}).slug,'micron');
  assert.equal(companyFields('US:NEWXYZ',{name:'Example Business Corporation'}).slug,'example-business-us-newxyz');
});
