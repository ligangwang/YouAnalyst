import {onboarding} from '../helpers/company-onboarding';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isSupportedCompany,supportedCompanyUniverse} from '../../src/lib/company-support/model';
import {planSupportedMigration} from '../../src/lib/company-support/migration';
import {migrateCompanyOnboarding} from '../../scripts/migrate-company-onboarding';
import {company,encode,type Document,type Request} from '../../scripts/lib/firestore-rest';
import seed from '../../data/investment-themes/catalog-v1.json';

const member={status:'PUBLISHED' as const,primarySector:'compute',reviewedAt:'2026-10-25'};
const row={id:'US:A',name:'A',status:'DIRECTORY',themeMemberships:{ai:member}};

test('supported membership is explicit and excludes queued, deleted and hidden companies',()=>{
  assert.equal(isSupportedCompany(row),false);
  for(const status of ['QUEUED','PROCESSING','BLOCKED','unknown'])assert.equal(isSupportedCompany({...row,onboarding:{status}}),false);
  const supported={...row,onboarding:onboarding()};
  assert(isSupportedCompany(supported));
  assert(isSupportedCompany({...supported,themeMemberships:{}}),'Themes do not independently alter job coverage');
  assert(!isSupportedCompany({...supported,isDeleted:true}));
  assert(!isSupportedCompany({...supported,status:'DRAFT'}));
  const graph=supportedCompanyUniverse([row,supported,{...supported,id:'XSHE:000001'}]);
  assert.deepEqual(graph.nodes.map(node=>node.id),['US:A','XSHE:000001']);
  assert.equal(graph.nodes[1].market,'CN_A');
  assert.deepEqual(graph.relationships,[]);
  const legacy={...supported,themeMemberships:undefined,inGraph:{status:'PUBLISHED',stageIds:['compute']}};
  assert.deepEqual(supportedCompanyUniverse([legacy]).nodes[0].stageIds,['compute']);
  assert.deepEqual(supportedCompanyUniverse([{...legacy,themeMemberships:{ai:{...member,status:'WITHDRAWN'}}}]).nodes[0].stageIds,[]);
});

test('migration grandfathers published coverage including legacy AI, but never overrides an active request',()=>{
  const legacy={id:'US:L',name:'Legacy',status:'PUBLISHED',inGraph:{status:'PUBLISHED'}};
  const withdrawn={...legacy,id:'US:W',themeMemberships:{ai:{...member,status:'WITHDRAWN' as const}}};
  const records=[row,legacy,withdrawn,{...row,id:'US:D',isDeleted:true},{...row,id:'US:H',status:'DRAFT'}];
  assert.deepEqual(planSupportedMigration(records,['ai']),['US:A','US:L']);
  assert.deepEqual(planSupportedMigration([{...row,onboarding:onboarding()}],['ai']),[]);
  assert.throws(()=>planSupportedMigration([{...row,onboarding:onboarding('QUEUED')}],['ai']),/conflicts/);
  assert.deepEqual(planSupportedMigration([row],['space']),[]);
});

test('migration previews without writes, uses updateTime fencing, and is idempotent after a paginated apply',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'company-support-'));
  const document=(id:string,data:object):Document=>({name:`projects/test-project/databases/(default)/documents/companies/${id}`,updateTime:'2026-10-25T00:00:00Z',fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,encode(value)]))});
  const docs=Array.from({length:6},(_,i)=>document(`US:A${i}`,{...row,id:undefined,profile:{keep:'unchanged'}}));
  for(const doc of docs){delete doc.fields.id;doc.fields.updatedAt={timestampValue:'2026-10-24T00:00:00Z'};}
  let commits=0,pauses=0;
  const request:Request=async(url,method,data)=>{
    if(url.endsWith(':runQuery'))return seed.nodes.map(node=>({document:document(node.id,{...node,status:'PUBLISHED'})}));
    if(url.includes('/companies?'))return url.includes('pageToken=next')?{documents:docs.slice(3)}:{documents:docs.slice(0,3),nextPageToken:'next'};
    if(url.endsWith(':commit')){
      commits++;
      const writes=(data as {writes:{update:Document;updateMask:{fieldPaths:string[]};currentDocument:{updateTime:string}}[]}).writes;
      assert(writes.length<=5);
      for(const write of writes){
        assert.deepEqual(write.updateMask.fieldPaths,['onboarding','updatedAt']);
        const doc=docs.find(doc=>doc.name===write.update.name)!;
        assert.equal(write.currentDocument.updateTime,doc.updateTime);
        Object.assign(doc.fields,write.update.fields);
      }
      return {};
    }
    assert.equal(method,undefined);
    return docs.find(doc=>url.endsWith(doc.name));
  };
  try{
    const preview=await migrateCompanyOnboarding({project:'test-project',request,backupDir:dir});
    assert.equal(commits,0);assert.equal(preview.selected.length,6);
    const result=await migrateCompanyOnboarding({project:'test-project',request,backupDir:dir,write:true,pause:async()=>{pauses++;}});
    assert.equal(result.written,6);assert.equal(commits,2);assert.equal(pauses,1);
    assert.equal(JSON.parse(await readFile(result.backup,'utf8')).originals.length,6);
    assert(docs.every(doc=>isSupportedCompany(company(doc))));
    assert.equal((await migrateCompanyOnboarding({project:'test-project',request,backupDir:dir})).selected.length,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
