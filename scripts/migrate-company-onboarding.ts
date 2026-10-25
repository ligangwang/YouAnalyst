import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {GoogleAuth} from 'google-auth-library';
import {company,type Document,type Request} from './lib/firestore-rest';
import {readThemeCatalog} from './lib/theme-catalog';
import {catalogThemeIds} from '../src/lib/company-themes/catalog-model';
import {planSupportedMigration} from '../src/lib/company-support/migration';

export async function migrateCompanyOnboarding({project,request,write=false,backupDir='output/company-onboarding-backups',pause=async()=>new Promise<void>(resolve=>setTimeout(resolve,1000))}:{
  project:string;request:Request;write?:boolean;backupDir?:string;pause?:()=>Promise<void>;
}) {
  assert(/^[a-z][a-z0-9-]+$/.test(project),'Explicit project required');
  const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const catalog=await readThemeCatalog(root,request),originals:Document[]=[];
  let pageToken:string|undefined;
  const seen=new Set<string>();
  do {
    const params=new URLSearchParams({pageSize:'500',...(pageToken?{pageToken}:{})});
    const page=await request(`${root}/companies?${params}`) as {documents?:Document[];nextPageToken?:string};
    originals.push(...page.documents??[]);
    assert(originals.length<=100_000,'Company directory exceeds migration safety bound');
    pageToken=page.nextPageToken;
    if(pageToken){assert(!seen.has(pageToken),'Repeated directory page token');seen.add(pageToken);}
  } while(pageToken);
  const selected=planSupportedMigration(originals.map(company),catalogThemeIds(catalog));
  const selectedIds=new Set(selected),docs=originals.filter(doc=>selectedIds.has(company(doc).id));
  for(const doc of docs)assert(doc.fields.updatedAt?.timestampValue,`${company(doc).id}: existing updatedAt timestamp required`);
  const at=new Date().toISOString();
  const onboarding={mapValue:{fields:{status:{stringValue:'SUPPORTED'},version:{integerValue:'1'},
    requestedAt:{nullValue:null},startedAt:{nullValue:null},supportedAt:{timestampValue:at},
    updatedAt:{timestampValue:at},blockedReason:{nullValue:null}}}};
  await mkdir(backupDir,{recursive:true});
  const backup=`${backupDir}/migration-${at.replace(/[:.]/g,'-')}-${randomUUID()}.json`;
  await writeFile(backup,JSON.stringify({project,at,mode:write?'write':'preview',selected,originals:docs,onboarding},null,2),{flag:'wx'});
  let written=0;
  if(write)for(let start=0;start<docs.length;start+=5){
    const batch=docs.slice(start,start+5);
    // Whole-document updateTime fencing prevents changing a concurrently edited
    // classification or overwriting a newly requested onboarding workflow.
    await request(`${root}:commit`,'POST',{writes:batch.map(doc=>({update:{name:doc.name,fields:{onboarding,updatedAt:{timestampValue:at}}},
      updateMask:{fieldPaths:['onboarding','updatedAt']},currentDocument:{updateTime:doc.updateTime}}))});
    written+=batch.length;
    for(const doc of batch){
      const after=await request(`https://firestore.googleapis.com/v1/${doc.name}`) as Document;
      assert.deepEqual(after.fields.onboarding,onboarding,'Onboarding verification failed');
      for(const [key,value] of Object.entries(doc.fields))if(key!=='updatedAt')assert.deepEqual(after.fields[key],value,`Unrelated field changed: ${key}`);
    }
    console.log(JSON.stringify({written,total:docs.length,backup}));
    if(start+5<docs.length)await pause();
  }
  return {mode:write?'written':'preview',scanned:originals.length,selected,written,backup};
}

async function main(){
  const project=process.env.GOOGLE_CLOUD_PROJECT;
  assert(project,'Set GOOGLE_CLOUD_PROJECT explicitly');
  const token=process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const client=token?null:await new GoogleAuth({scopes:['https://www.googleapis.com/auth/datastore']}).getClient();
  const request:Request=async(url,method='GET',data)=>{
    if(client)return (await client.request({url,method,data})).data;
    const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30_000)});
    assert(response.ok,`Firestore ${method} failed (${response.status})`);
    return response.json();
  };
  console.log(JSON.stringify(await migrateCompanyOnboarding({project,request,write:process.argv.includes('--write')})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
