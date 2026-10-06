import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {GoogleAuth} from 'google-auth-library';
import {NEWS_SOURCES,IR_SOURCES_REQUIRING_REVIEW} from './seed-news-sources';
import {validateCompanyNewsSource,type CompanyNewsSource} from '../src/lib/intelligence/collectors/sources';
import {company,encode,type Request,type Document} from './migrate-company-themes';

export async function publishNewsSources({project,sources,request,write=false,backupDir='output/company-theme-backups'}:{project:string;sources:CompanyNewsSource[];request:Request;write?:boolean;backupDir?:string}){
  assert(/^[a-z][a-z0-9-]+$/.test(project)&&sources.length>0&&sources.length<=400,'Explicit project and bounded source batch required');
  assert(new Set(sources.map(source=>source.id)).size===sources.length,'Duplicate source IDs');
  sources.forEach(source=>validateCompanyNewsSource(source,source.companyId));
  const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  // Derived ownership guard in the existing collectors collection serializes
  // publishers without moving the authoritative feed configuration from companies.
  const guardUrl=`${root}/collectors/news-source-registry`;
  const guard=await request(guardUrl) as Document|null;
  const owners=structuredClone(guard?company(guard).sourceOwners??{}:{}) as Record<string,string>;
  const queries=[{fieldFilter:{field:{fieldPath:'themeIds'},op:'ARRAY_CONTAINS_ANY',value:{arrayValue:{values:['ai','robotics','space'].map(stringValue=>({stringValue}))}}}},...['inGraph.status','aiGraph.status'].map(fieldPath=>({fieldFilter:{field:{fieldPath},op:'EQUAL',value:{stringValue:'PUBLISHED'}}}))];
  for(const where of queries){
    const rows=await request(`${root}:runQuery`,'POST',{structuredQuery:{from:[{collectionId:'companies'}],where,select:{fields:[{fieldPath:'newsSources'}]}}}) as {document?:Document}[];
    for(const {document} of rows){if(!document)continue;const row=company(document);for(const feed of (row.newsSources??[]) as CompanyNewsSource[]){
      validateCompanyNewsSource(feed,row.id);
      assert(!owners[feed.id]||owners[feed.id]===row.id,`${feed.id}: source ID belongs to another company`);owners[feed.id]=row.id;
    }}
  }
  for(const source of sources){assert(!owners[source.id]||owners[source.id]===source.companyId,`${source.id}: source ID belongs to another company`);owners[source.id]=source.companyId;}
  const ids=[...new Set(sources.map(source=>source.companyId))];
  const docs=await Promise.all(ids.map(id=>request(`${root}/companies/${encodeURIComponent(id)}`) as Promise<Document|null>));
  assert(docs.every(Boolean),'Source companies must already exist');
  const originals=docs as Document[];
  const patches=originals.flatMap(doc=>{
    const row=company(doc);assert(['DIRECTORY','PUBLISHED'].includes(String(row.status)),'Company is not published');
    assert(row.newsSources===undefined||Array.isArray(row.newsSources),'Invalid existing newsSources');
    const merged=structuredClone(row.newsSources??[]) as CompanyNewsSource[];
    for(const source of sources.filter(source=>source.companyId===row.id)){
      const old=merged.find(item=>item.id===source.id);
      assert(!old||isDeepStrictEqual(old,source),`${source.id}: existing source decision conflicts`);
      if(!old)merged.push(source);
    }
    return isDeepStrictEqual(row.newsSources,merged)?[]:[{doc,merged}];
  });
  await mkdir(backupDir,{recursive:true});const backup=`${backupDir}/news-sources-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  await writeFile(backup,JSON.stringify({project,originals,sources,patches,guard,owners},null,2),{flag:'wx'});
  const guardChanged=!guard||!isDeepStrictEqual(company(guard).sourceOwners,owners);
  if(write&&(patches.length||guardChanged)){
    await request(`${root}:commit`,'POST',{writes:[...patches.map(({doc,merged})=>({update:{name:doc.name,fields:{newsSources:encode(merged)}},updateMask:{fieldPaths:['newsSources']},currentDocument:{updateTime:doc.updateTime}})),{update:{name:guardUrl.replace('https://firestore.googleapis.com/v1/',''),fields:{sourceOwners:encode(owners)}},updateMask:{fieldPaths:['sourceOwners']},currentDocument:guard?{updateTime:guard.updateTime}:{exists:false}}]});
    for(const {doc,merged} of patches){const next=await request(`https://firestore.googleapis.com/v1/${doc.name}`) as Document;assert.deepEqual(company(next).newsSources,merged);for(const [key,value] of Object.entries(doc.fields))if(key!=='newsSources')assert.deepEqual(next.fields[key],value,`Unrelated company field changed: ${key}`);}
  }
  return {mode:write?'written':'preview',companies:ids.length,sources:sources.length,changed:patches.length,backup};
}
async function main(){
  const project=process.env.GOOGLE_CLOUD_PROJECT;assert(project,'Set GOOGLE_CLOUD_PROJECT');
  const file=process.argv.find(arg=>arg.startsWith('--batch='))?.slice(8);
  assert(file||process.argv.includes('--migrate-existing'),'Use --batch=<reviewed JSON> or --migrate-existing');
  const sources=file?JSON.parse(await readFile(file,'utf8')) as CompanyNewsSource[]:[...NEWS_SOURCES.map(source=>({...source,status:'PUBLISHED' as const,reviewedAt:'2026-10-06'})),...IR_SOURCES_REQUIRING_REVIEW.map(source=>({...source,status:'DRAFT' as const,reviewedAt:'2026-10-06'}))];
  const client=process.env.GOOGLE_OAUTH_ACCESS_TOKEN?null:await new GoogleAuth({scopes:['https://www.googleapis.com/auth/datastore']}).getClient();
  const request:Request=async(url,method='GET',data)=>{
    if(client){const response=await client.request({url,method,data,validateStatus:status=>status>=200&&status<300||method==='GET'&&status===404});return response.status===404?null:response.data;}
    const response=await fetch(url,{method,headers:{Authorization:`Bearer ${process.env.GOOGLE_OAUTH_ACCESS_TOKEN}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30_000)});
    if(method==='GET'&&response.status===404)return null;assert(response.ok,`Firestore ${method} failed (${response.status})`);return response.json();
  };
  console.log(JSON.stringify(await publishNewsSources({project,sources,request,write:process.argv.includes('--write')})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
