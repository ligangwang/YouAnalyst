import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { GoogleAuth } from 'google-auth-library';
import { validateThemeCatalog, type ThemeCatalog } from '../src/lib/company-themes/catalog-model';
import { company, encode, type Document, type Request } from './lib/firestore-rest';

type CatalogRecord=ThemeCatalog[number]&{status:string;isDeleted?:boolean};
/** Only add catalog nodes and attach the three legacy roots to their agreed family. */
export function planThemeCatalog(existing:CatalogRecord[], seed:CatalogRecord[]){
  validateThemeCatalog(seed);
  assert(seed.every(node=>node.status==='PUBLISHED'&&!node.isDeleted),'Seed must contain only published nodes');
  const merged=new Map(existing.map(node=>[node.id,structuredClone(node)]));
  const patches:CatalogRecord[]=[];
  for(const desired of seed){
    const old=merged.get(desired.id);
    if(old){
      assert(old.status==='PUBLISHED' && !old.isDeleted,`${old.id}: existing editorial status conflicts`);
      if(['ai','robotics','space'].includes(old.id) && old.parentId===null){
        const changed={...old,parentId:desired.parentId};merged.set(old.id,changed);patches.push(changed);
      } else assert.equal(old.parentId,desired.parentId,`${old.id}: existing parent conflicts`);
      // Existing names, descriptions and ordering remain authoritative.
    } else {merged.set(desired.id,desired);patches.push(desired);}
  }
  validateThemeCatalog([...merged.values()].filter(node=>node.status==='PUBLISHED'&&!node.isDeleted));
  assert(patches.length<=400,'Catalog publication exceeds one bounded atomic commit');
  return patches;
}
export async function publishInvestmentThemes({project,seed,request,write=false,backupDir='output/investment-theme-backups'}:{project:string;seed:CatalogRecord[];request:Request;write?:boolean;backupDir?:string}){
  assert(/^[a-z][a-z0-9-]+$/.test(project),'Explicit project required');
  const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const read=async()=>{
    const rows=await request(`${root}:runQuery`,'POST',{structuredQuery:{from:[{collectionId:'investment_themes'}],limit:2001}}) as {document?:Document}[];
    const docs=rows.flatMap(row=>row.document?[row.document]:[]);
    assert(docs.length<=2000,'Existing catalog exceeds safe size');return docs;
  };
  const originals=await read(),records=originals.map(company) as unknown as CatalogRecord[];
  const patches=planThemeCatalog(records,seed);
  await mkdir(backupDir,{recursive:true});
  const backup=`${backupDir}/catalog-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.json`;
  await writeFile(backup,JSON.stringify({project,originals,patches},null,2),{flag:'wx'});
  if(write&&patches.length){
    await request(`${root}:commit`,'POST',{writes:patches.map(({id,...data})=>{
      const old=originals.find(doc=>company(doc).id===id);
      const fields=old?{parentId:encode(data.parentId)}:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,encode(value)]));
      return {update:{name:`projects/${project}/databases/(default)/documents/investment_themes/${id}`,fields},
        ...(old?{updateMask:{fieldPaths:['parentId']},currentDocument:{updateTime:old.updateTime}}:{currentDocument:{exists:false}})};
    })});
    const after=await read();
    assert.equal(planThemeCatalog(after.map(company) as unknown as CatalogRecord[],seed).length,0,'Catalog publication must be idempotent');
    for(const old of originals){
      const updated=after.find(doc=>doc.name===old.name)!;assert(updated,'Existing catalog node disappeared');
      for(const [key,value] of Object.entries(old.fields))if(key!=='parentId')assert(isDeepStrictEqual(updated.fields[key],value),'Existing catalog metadata changed');
    }
  }
  return {mode:write?'written':'preview',changed:patches.length,companyWrites:0,backup};
}
async function main(){
  const project=process.env.GOOGLE_CLOUD_PROJECT;assert(project,'Set GOOGLE_CLOUD_PROJECT explicitly');
  const seed=JSON.parse(await readFile('data/investment-themes/catalog-v1.json','utf8')).nodes as CatalogRecord[];
  const token=process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/datastore']}),client=token?null:await auth.getClient();
  const request:Request=async(url,method='GET',data)=>{
    if(client)return (await client.request({url,method,data})).data;
    const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30000)});
    assert(response.ok,`Catalog request failed (${response.status})`);return response.json();
  };
  console.log(JSON.stringify(await publishInvestmentThemes({project,seed,request,write:process.argv.includes('--write')})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
