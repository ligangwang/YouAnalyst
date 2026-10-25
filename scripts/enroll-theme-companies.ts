import {planEnrollment,type EnrollmentBatch} from '../src/lib/company-themes/enrollment';
export {planEnrollment,type EnrollmentBatch} from '../src/lib/company-themes/enrollment';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {GoogleAuth} from 'google-auth-library';
import {company, encode, type Document, type Request} from './lib/firestore-rest';
import {readThemeCatalog} from './lib/theme-catalog';

export async function enrollCompanies({project,batch,request,write=false,backupDir='output/company-theme-backups'}:{project:string;batch:EnrollmentBatch;request:Request;write?:boolean;backupDir?:string}){
  assert(/^[a-z][a-z0-9-]+$/.test(project),'Explicit project required');
  const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const catalog=await readThemeCatalog(root,request);
  const docs=await Promise.all(batch.companies.map(row=>request(`${root}/companies/${encodeURIComponent(row.id)}`) as Promise<Document|null>));
  assert(docs.every(Boolean),'All companies must exist in the canonical directory');
  const originals=docs as Document[],patches=planEnrollment(originals.map(company),batch,catalog);
  await mkdir(backupDir,{recursive:true});
  const backup=`${backupDir}/enrollment-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.json`;
  await writeFile(backup,JSON.stringify({project,batch,originals,patches},null,2),{flag:'wx'});
  if(write&&patches.length){
    await request(`${root}:commit`,'POST',{writes:patches.map(patch=>{const old=originals.find(doc=>company(doc).id===patch.id)!;return {update:{name:old.name,fields:Object.fromEntries(Object.entries(patch.fields).map(([key,value])=>[key,encode(value)]))},updateMask:{fieldPaths:Object.keys(patch.fields)},currentDocument:{updateTime:old.updateTime}};})});
    const after=await Promise.all(originals.map(doc=>request(`https://firestore.googleapis.com/v1/${doc.name}`) as Promise<Document>));
    for(let i=0;i<originals.length;i++)for(const [key,value] of Object.entries(originals[i].fields))if(!Object.hasOwn(patches.find(patch=>patch.id===company(originals[i]).id)?.fields??{},key))assert.deepEqual(after[i].fields[key],value,`${company(originals[i]).id}: unrelated field changed`);
    assert.equal(planEnrollment(after.map(company),batch,catalog).length,0,'Enrollment must be idempotent');
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
