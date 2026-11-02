import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withCacheReadScope} from '../../src/lib/change-cache';
import {loadNewsCollectionContext} from '../../src/lib/intelligence/collectors/source-service';
import {readCollectionCompanies,readSecCollectionCompany} from '../../src/lib/company-support/collection-reader';
import {companySnapshotFixture} from '../helpers/company-snapshot';

const supported={name:'Issuer',status:'DIRECTORY',country:'US',onboarding:{status:'SUPPORTED'}};
const source={id:'company-news',companyId:'US:A',name:'Company news',url:'https://example.com/news.rss',allowedHosts:['example.com'],pollMs:60000,status:'PUBLISHED',reviewedAt:'2025-01-01'};

test('parallel collector lists and single-company tasks share one snapshot and watermark catch-up',async()=>{
 const records=new Map<string,Record<string,unknown>>(Array.from({length:501},(_,i)=>['US:C'+String(i).padStart(5,'0'),{...supported}]));
 records.set('US:A',{...supported,newsSources:[source],cik:'0000000001',classification:['1234']});
 Object.defineProperty(records.get('US:A')!,'searchPrefixes',{get:()=>{throw Error('Projection must not expand search index');}});
 const f=companySnapshotFixture(records,[{id:'US:NEW',data:{...supported,cik:'0000000002'}}]);
 try{
  const [context,company,scope]=await Promise.all([withCacheReadScope(()=>loadNewsCollectionContext(f.db)),readSecCollectionCompany(f.db,'US:NEW'),readCollectionCompanies(f.db,[],'US')]);
  assert.equal(context.graph.nodes.length,503);assert.equal(scope.length,503);assert.equal(company?.cik,'0000000002');
  assert.deepEqual(context.sources.map(s=>s.id),['company-news']);assert.equal(f.loads,1);assert.equal(f.reads,0);
  assert.deepEqual(f.boundaries,[f.watermark]);
  assert.deepEqual((await readSecCollectionCompany(f.db,'US:A'))?.classification,['1234']);
  await loadNewsCollectionContext(f.db);assert.equal(f.loads,1);assert.equal(f.boundaries.length,1);
 }finally{f.close();}
});

test('live deltas remove blocked and deleted companies and withdrawn news sources from memory',async()=>{
 const f=companySnapshotFixture(new Map<string,Record<string,unknown>>([['US:A',{...supported,newsSources:[source]}],['US:B',supported],['US:C',supported]]));
 try{
  assert.equal((await loadNewsCollectionContext(f.db)).sources.length,1);
  f.change([{id:'US:A',data:{...supported,newsSources:[{...source,status:'WITHDRAWN'}]}},{id:'US:B',data:{isDeleted:true}},{id:'US:C',data:{...supported,onboarding:{status:'BLOCKED'}}}]);
  const context=await loadNewsCollectionContext(f.db);assert.equal(context.sources.length,0);assert.deepEqual(context.graph.nodes.map(n=>n.id),['US:A']);
  assert.equal(await readSecCollectionCompany(f.db,'US:B'),undefined);
  f.change([{id:'US:A',data:{...supported,supersededByCompanyId:'US:OTHER'}}]);
  assert.equal((await loadNewsCollectionContext(f.db)).graph.nodes.length,0);assert.equal(f.loads,1);assert.equal(f.reads,0);
 }finally{f.close();}
});

test('company projections preserve publisher validation',async()=>{
 const f=companySnapshotFixture(new Map<string,Record<string,unknown>>([['US:A',{...supported,newsSources:[{...source,url:'https://evil.org/feed'}]}]]));
 try{await assert.rejects(loadNewsCollectionContext(f.db),/Unapproved feed/);}finally{f.close();}
});

test('regional selectors filter the shared snapshot locally',async()=>{
 const f=companySnapshotFixture(new Map<string,Record<string,unknown>>(['ORG:PRIVATE','US:A','US:Z','XSHE:000001','XSHG:600000','XSHG;OTHER'].map(id=>[id,supported])));
 try{
  assert.deepEqual((await readCollectionCompanies(f.db,[],'CN')).map(c=>c.id),['XSHE:000001','XSHG:600000']);
  assert.deepEqual((await readCollectionCompanies(f.db,[],'US')).map(c=>c.id),['US:A','US:Z']);
  assert.equal(f.loads,1);assert.equal(f.reads,0);
 }finally{f.close();}
});
