import assert from 'node:assert/strict';
import test from 'node:test';
import {planEnrollment, enrollCompanies, type EnrollmentBatch} from '../scripts/enroll-theme-companies';
import {encode, company, type Document} from '../scripts/migrate-company-themes';
import healthcare from '../data/ai-supply-chain/healthcare-enrollment.json';
import ai from '../data/ai-supply-chain/ai-us.json';
import cn from '../data/ai-supply-chain/ai-cn-a.json';
import {publishNewsSources} from '../scripts/publish-news-sources';
import type {CompanyNewsSource} from '../src/lib/intelligence/collectors/sources';

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

test('adding equipment companies retains canonical stage names and order',()=>{
  const proposal={...batch.companies[0],primarySector:'semiconductors',aiStageIds:['equipment']};
  const [patch]=planEnrollment(profiles,{...batch,companies:[proposal]});
  const canonical=ai.nodes.find(row=>row.id==='stage:equipment')!;
  assert.deepEqual((patch.fields.inGraph as {stages:unknown[]}).stages,[{...canonical,labels:{en:canonical.label,'zh-CN':cn.nodes.find(row=>row.id===canonical.id)!.label}}]);
});

test('source publication rejects IDs owned outside its batch before any write',async()=>{
  const feed:CompanyNewsSource={id:'existing-ir',companyId:'US:TEM',name:'IR',url:'https://investors.tempus.com/rss.xml',allowedHosts:['investors.tempus.com'],pollMs:3600000,status:'PUBLISHED',reviewedAt:'2026-10-06'};
  const outside:Document={name:'projects/example/databases/(default)/documents/companies/US:OTHER',updateTime:'2026-10-06T00:00:00Z',fields:{newsSources:encode([{...feed,companyId:'US:OTHER'}])}};
  await assert.rejects(publishNewsSources({project:'example',sources:[feed],request:async(url)=>{if(url.endsWith('/collectors/news-source-registry'))return null;assert(url.endsWith(':runQuery'));return [{document:outside}];}}),/belongs to another company/);
});

test('source ownership and company changes share one fenced commit',async()=>{
  const feed:CompanyNewsSource={id:'new-ir',companyId:'US:TEM',name:'IR',url:'https://investors.tempus.com/rss.xml',allowedHosts:['investors.tempus.com'],pollMs:3600000,status:'PUBLISHED',reviewedAt:'2026-10-06'};
  const doc:Document={name:'projects/example/databases/(default)/documents/companies/US:TEM',updateTime:'2026-10-06T00:00:00Z',fields:{name:encode('Tempus'),status:encode('DIRECTORY')}};
  const guard:Document={name:'projects/example/databases/(default)/documents/collectors/news-source-registry',updateTime:'2026-10-06T01:00:00Z',fields:{sourceOwners:encode({})}};
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const backupDir=await mkdtemp(`${tmpdir()}/news-publisher-`);
  try{await publishNewsSources({project:'example',sources:[feed],write:true,backupDir,request:async(url,method,data)=>{
    if(url.endsWith(':runQuery'))return [{document:{name:'projects/example/databases/(default)/documents/companies/US:NOFEED',updateTime:doc.updateTime}}];
    if(url.endsWith(':commit')){
      const {writes}=data as {writes:{update:{name:string;fields:Document['fields']};currentDocument:{updateTime:string}}[]};
      assert.equal(writes.length,2);assert.equal(writes[1].update.name,guard.name);assert.deepEqual(writes[1].currentDocument,{updateTime:guard.updateTime});
      Object.assign(doc.fields,writes[0].update.fields);return {};
    }
    assert(!method||method==='GET');return url.endsWith('news-source-registry')?guard:doc;
  }});}finally{await rm(backupDir,{recursive:true,force:true});}
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
