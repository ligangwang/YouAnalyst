import assert from 'node:assert/strict';
import test from 'node:test';
import {planEnrollment, enrollCompanies, type EnrollmentBatch} from '../scripts/enroll-theme-companies';
import {encode, company, type Document} from '../scripts/migrate-company-themes';
import healthcare from '../data/ai-supply-chain/healthcare-enrollment.json';

const batch=healthcare as EnrollmentBatch;
const profiles=batch.companies.map(row=>({id:row.id,name:row.expectedName,status:'DIRECTORY',market:'US',exchange:'NASDAQ',symbol:row.id.slice(3),profile:{financialReport:{url:'https://www.sec.gov/example'}}}));

test('AI enrollment is data-only, preserves other themes and reaches the deployed graph reader',()=>{
  const old={...profiles[0],themeMemberships:{space:{status:'PUBLISHED' as const,primarySector:'operators',reviewedAt:'2026-10-04'}},themeIds:['space']};
  const patches=planEnrollment([old,profiles[1]],batch);
  assert.equal(patches.length,2);
  assert.deepEqual(patches[0].fields.themeIds,['ai','space']);
  assert.deepEqual((patches[0].fields.themeMemberships as typeof old.themeMemberships).space,old.themeMemberships.space);
  assert.deepEqual((patches[0].fields.inGraph as {stageIds:string[]}).stageIds,['applications']);
  assert(!('profile' in patches[0].fields));
  assert(!('name' in patches[0].fields));
  assert.equal(planEnrollment([old,profiles[1]].map(row=>({...row,...patches.find(patch=>patch.id===row.id)!.fields})),batch).length,0);
});

test('enrollment rejects identity drift, editorial conflicts, unsafe sources and unknown sectors',()=>{
  assert.throws(()=>planEnrollment([{...profiles[0],name:'Different issuer'},profiles[1]],batch),/identity changed/);
  assert.throws(()=>planEnrollment([{...profiles[0],aiGraph:{status:'PUBLISHED'}},profiles[1]],batch),/AI map decision conflicts/);
  assert.throws(()=>planEnrollment(profiles,{...batch,companies:[{...batch.companies[0],primarySector:'healthcare'}]}),/Unknown primary sector/);
  assert.throws(()=>planEnrollment(profiles,{...batch,companies:[{...batch.companies[0],sources:[{url:'http://example.com',title:'x',summary:'x'}]}]}),/Invalid reviewed source/);
});

test('preview does not commit and a write uses exact update-time preconditions',async()=>{
  const docs:Document[]=profiles.map(row=>({name:`projects/example/databases/(default)/documents/companies/${row.id}`,updateTime:'2026-10-06T00:00:00Z',fields:Object.fromEntries(Object.entries(row).map(([key,value])=>[key,encode(value)]))}));
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const backupDir=await mkdtemp(`${tmpdir()}/theme-enrollment-`);
  let commits=0;
  try{
    await enrollCompanies({project:'example',batch,backupDir,request:async(url,method)=>{assert.equal(method,undefined);return docs.find(doc=>url.endsWith(encodeURIComponent(company(doc).id)))!;}});
    await enrollCompanies({project:'example',batch,backupDir,write:true,request:async(url,method,data)=>{
      if(method==='POST'){
        commits++;
        const {writes}=data as {writes:{update:{name:string;fields:Document['fields']};currentDocument:{updateTime:string}}[]};
        assert.equal(writes.length,2);
        for(const write of writes){assert.equal(write.currentDocument.updateTime,docs[0].updateTime);Object.assign(docs.find(doc=>doc.name===write.update.name)!.fields,write.update.fields);}
        return {};
      }
      return docs.find(doc=>url.endsWith(encodeURIComponent(company(doc).id))||url.endsWith(doc.name))!;
    }});
    assert.equal(commits,1);
  }finally{await rm(backupDir,{recursive:true,force:true});}
});
