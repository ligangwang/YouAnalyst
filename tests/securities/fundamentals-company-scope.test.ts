import {withThemeCatalog} from '../helpers/theme-catalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { loadFundamentalsCompanyIds } from '../../src/lib/fundamentals/company-scope';

test('fundamentals use one theme query and retain canonical IDs for both markets', async () => {
  const membership = {status:'PUBLISHED',primarySector:'compute',reviewedAt:'2026-10-18'};
  const rows = [
    {id:'US:NVDA',name:'NVIDIA',status:'DIRECTORY',themeMemberships:{ai:membership}},
    {id:'US:RKLB',name:'Rocket Lab',status:'PUBLISHED',themeMemberships:{space:membership}},
    {id:'XSHG:688041',name:'Hygon',status:'PUBLISHED',themeMemberships:{ai:membership}},
    {id:'XSHE:300024',name:'Robot',status:'DIRECTORY',themeMemberships:{robotics:membership}},
    {id:'ORG:OPENAI',name:'OpenAI',status:'DIRECTORY',themeMemberships:{ai:membership}},
    {id:'US:DRAFT',name:'Draft',status:'DRAFT',themeMemberships:{ai:membership}},
    {id:'US:OLD',name:'Withdrawn',status:'DIRECTORY',themeMemberships:{ai:{...membership,status:'WITHDRAWN'}}},
  ];
  let queries = 0;
  const db =withThemeCatalog({collection:(collection:string)=>{
    assert.equal(collection,'companies');
    return {where:(field:string,op:string,themes:string[])=>{
      assert.equal(field,'themeIds');assert.equal(op,'array-contains-any');
      assert.deepEqual(themes,['ai','robotics','space']);queries++;
      return {get:async()=>({docs:rows.map(row=>({id:row.id,data:()=>row}))})};
    }};
  }} as unknown as Firestore);
  assert.deepEqual(await loadFundamentalsCompanyIds(db,'US'),['US:NVDA','US:RKLB']);
  assert.equal(queries,1);
  assert.deepEqual(await loadFundamentalsCompanyIds(db,'CN_A'),['XSHE:300024','XSHG:688041']);
  assert.equal(queries,2);
});
