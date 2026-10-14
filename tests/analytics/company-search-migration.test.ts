import assert from 'node:assert/strict';
import test from 'node:test';
import {companySearchMigration} from '../../src/lib/market-companies/search-migration';
import {companySearchFields,RETIRED_COMPANY_SEARCH_FIELDS} from '../../src/lib/market-companies/search';
test('every Chinese name or alias generates native, full pinyin and initials in one index',()=>{
 for(const [id,name,pinyin,initials] of [['US:AMD','超微半导体','chaoweibandaoti','cwbdt'],['US:NVDA','英伟达','yingweida','ywd'],['XSHG:600519','贵州茅台','guizhoumaotai','gzmt']]){
  const fields=companySearchFields(id,{name:'Company',aliases:[name]});
  for(const value of [name,pinyin,initials])assert(fields.searchPrefixes.includes(value),value);
  assert.equal(Object.hasOwn(fields,'pinyinSearchPrefixes'),false);
 }
});
test('migration preserves existing aliases and identity, is idempotent, and defers removed fields until cleanup',()=>{
 const original={name:'AMD',symbol:'AMD',names:{'zh-CN':'超威'},aliases:['Advanced Micro Devices'],slug:'amd',symbolPrefixes:['a','am','amd'],pinyinSearchTerms:['chaowei'],pinyinSearchPrefixes:['cw'],pinyinSearchVersion:1};
 const first=companySearchMigration('US:AMD',original);
 assert(first.changed);assert.deepEqual(first.removed,[]);
 assert.deepEqual(first.patch.aliases,['Advanced Micro Devices','超微半导体']);
 for(const field of ['name','symbol','slug','names'])assert.equal(Object.hasOwn(first.patch,field),false);
 const prepared={...original,...first.patch};assert.equal(companySearchMigration('US:AMD',prepared).changed,false);
 const cleanup=companySearchMigration('US:AMD',prepared,true);assert.deepEqual(cleanup.removed,[...RETIRED_COMPANY_SEARCH_FIELDS]);
 const cleaned={...prepared} as Record<string,unknown>;for(const field of cleanup.removed)delete cleaned[field];
 assert.equal(companySearchMigration('US:AMD',cleaned,true).changed,false);
});
