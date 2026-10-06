import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {GoogleAuth} from 'google-auth-library';
import {activeThemeIds, COMPANY_THEMES, type CompanyThemeId, type ThemedCompany} from '../src/lib/company-themes/model';
import {graphSectors} from '../src/lib/knowledge-graph/sectors';
import {company, encode, type Document, type Request} from './migrate-company-themes';

export type EnrollmentBatch = {theme:CompanyThemeId; reviewedAt:string; companies:{
  id:string; expectedName:string; primarySector:string; secondaryRoles?:string[]; aiStageIds?:string[];
  sources:{url:string; title:string; summary:string}[];
}[]};

/** Existing canonical profiles only; never replace an editorial decision or relationship. */
export function planEnrollment(records:ThemedCompany[], batch:EnrollmentBatch) {
  assert(COMPANY_THEMES.includes(batch.theme),'Unknown theme');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(batch.reviewedAt)&&new Date(batch.reviewedAt).toISOString().slice(0,10)===batch.reviewedAt&&batch.reviewedAt<=new Date().toISOString().slice(0,10),'Invalid review date');
  assert(batch.companies.length>0&&batch.companies.length<=100,'Invalid batch size');
  assert(new Set(batch.companies.map(row=>row.id)).size===batch.companies.length,'Duplicate identity');
  return batch.companies.flatMap(proposal=>{
    assert(/^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(proposal.id),'Invalid canonical identity');
    const record=records.find(row=>row.id===proposal.id);
    assert(record&&record.name===proposal.expectedName&&['PUBLISHED','DIRECTORY'].includes(String(record.status)),`${proposal.id}: missing canonical profile or identity changed`);
    const sectors=graphSectors(batch.theme),sector=sectors.find(row=>row.id===proposal.primarySector);
    assert(sector,'Unknown primary sector');
    const secondary=proposal.secondaryRoles??[];
    assert(new Set(secondary).size===secondary.length&&!secondary.includes(proposal.primarySector)&&secondary.every(id=>sectors.some(row=>row.id===id)),'Invalid secondary sectors');
    assert(proposal.sources.length>0,'Reviewed sources required');
    for(const source of proposal.sources){const url=new URL(source.url);assert(url.protocol==='https:'&&!url.username&&!url.password&&source.title.trim()&&source.summary.trim(),'Invalid reviewed source');}
    const membership={status:'PUBLISHED' as const,primarySector:proposal.primarySector,secondaryRoles:secondary,reviewedAt:batch.reviewedAt,sources:proposal.sources};
    const memberships=structuredClone(record.themeMemberships??{});
    assert(!memberships[batch.theme]||isDeepStrictEqual(memberships[batch.theme],membership),`${proposal.id}: existing theme decision conflicts`);
    memberships[batch.theme]=membership;
    const fields:Record<string,unknown>={themeMemberships:memberships,themeIds:activeThemeIds({themeMemberships:memberships})};
    if(batch.theme==='ai'){
      // The deployed AI reader uses inGraph; write its projection and the job index atomically.
      const stageIds=proposal.aiStageIds??[sector.stages[0]];
      assert(stageIds.length>0&&new Set(stageIds).size===stageIds.length&&stageIds.every(stage=>[sector,...sectors.filter(row=>secondary.includes(row.id))].some(row=>row.stages.includes(stage))),'Invalid AI stages');
      const sources=proposal.sources.map((source,index)=>({id:`theme:ai:${proposal.id}:${index}`,url:source.url,title:source.title,sourceDate:null}));
      const stages=stageIds.map(stage=>({id:`stage:${stage}`,kind:'STAGE',order:stage==='applications'?17:100,label:stage==='applications'?'AI software & applications':sectors.find(row=>row.stages.includes(stage))!.en,labels:{en:stage==='applications'?'AI software & applications':sectors.find(row=>row.stages.includes(stage))!.en,'zh-CN':stage==='applications'?'AI 软件与应用':sectors.find(row=>row.stages.includes(stage))!.zh}}));
      const graph={status:'PUBLISHED',stageIds,stages,memberships:stageIds.map(stage=>({id:`theme:ai:${proposal.id}:stage:${stage}`,source:proposal.id,target:`stage:${stage}`,type:'PARTICIPATES_IN',summary:proposal.sources.map(source=>source.summary).join(' '),sourceIds:sources.map(source=>source.id),commercialStatus:'NOT_A_COMMERCIAL_RELATIONSHIP'})),sources,order:1000,asOf:batch.reviewedAt};
      assert(!record.inGraph&&!record.aiGraph||isDeepStrictEqual(record.inGraph??record.aiGraph,graph),`${proposal.id}: existing AI map decision conflicts`);
      fields.inGraph=graph;
    }
    if(!record.description)fields.description=proposal.sources.map(source=>source.summary).join(' ');
    // Directory exchange metadata is already verified by the directory job.
    if(record.market==='US'&&record.exchange&&record.symbol&&!record.listingStatus&&!record.listings){fields.listingStatus='PUBLIC';fields.listings=[{market:record.market,exchange:record.exchange,symbol:record.symbol}];}
    return Object.entries(fields).every(([key,value])=>isDeepStrictEqual(record[key],value))?[]:[{id:proposal.id,fields}];
  });
}

export async function enrollCompanies({project,batch,request,write=false,backupDir='output/company-theme-backups'}:{project:string;batch:EnrollmentBatch;request:Request;write?:boolean;backupDir?:string}){
  assert(/^[a-z][a-z0-9-]+$/.test(project),'Explicit project required');
  const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const docs=await Promise.all(batch.companies.map(row=>request(`${root}/companies/${encodeURIComponent(row.id)}`) as Promise<Document|null>));
  assert(docs.every(Boolean),'All companies must exist in the canonical directory');
  const originals=docs as Document[],patches=planEnrollment(originals.map(company),batch);
  await mkdir(backupDir,{recursive:true});
  const backup=`${backupDir}/enrollment-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  await writeFile(backup,JSON.stringify({project,batch,originals,patches},null,2),{flag:'wx'});
  if(write&&patches.length){
    await request(`${root}:commit`,'POST',{writes:patches.map(patch=>{const old=originals.find(doc=>company(doc).id===patch.id)!;return {update:{name:old.name,fields:Object.fromEntries(Object.entries(patch.fields).map(([key,value])=>[key,encode(value)]))},updateMask:{fieldPaths:Object.keys(patch.fields)},currentDocument:{updateTime:old.updateTime}};})});
    const after=await Promise.all(originals.map(doc=>request(`https://firestore.googleapis.com/v1/${doc.name}`) as Promise<Document>));
    for(let i=0;i<originals.length;i++)for(const [key,value] of Object.entries(originals[i].fields))if(!Object.hasOwn(patches.find(patch=>patch.id===company(originals[i]).id)?.fields??{},key))assert.deepEqual(after[i].fields[key],value,`${company(originals[i]).id}: unrelated field changed`);
    assert.equal(planEnrollment(after.map(company),batch).length,0,'Enrollment must be idempotent');
  }
  return {mode:write?'written':'preview',theme:batch.theme,companies:batch.companies.map(row=>row.id),changed:patches.length,backup};
}

async function main(){
  const project=process.env.GOOGLE_CLOUD_PROJECT,file=process.argv.find(arg=>arg.startsWith('--batch='))?.slice(8);
  assert(project&&file,'Set GOOGLE_CLOUD_PROJECT and --batch=<reviewed JSON file>');
  const batch=JSON.parse(await readFile(file,'utf8')) as EnrollmentBatch;
  const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/datastore']});
  const client=process.env.GOOGLE_OAUTH_ACCESS_TOKEN?null:await auth.getClient();
  const request:Request=async(url,method='GET',data)=>{
    if(client){const r=await client.request({url,method,data,validateStatus:status=>status>=200&&status<300||method==='GET'&&status===404});return r.status===404?null:r.data;}
    const r=await fetch(url,{method,headers:{Authorization:`Bearer ${process.env.GOOGLE_OAUTH_ACCESS_TOKEN}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30_000)});
    if(method==='GET'&&r.status===404)return null;
    assert(r.ok,`Firestore ${method} failed (${r.status})`);return r.json();
  };
  console.log(JSON.stringify(await enrollCompanies({project,batch,request,write:process.argv.includes('--write')})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
