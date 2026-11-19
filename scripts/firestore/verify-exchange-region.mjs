import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {retainedReadReady,companyQueryParents} from '../lib/retained-firestore-paths.mjs';
export async function verifyExchangeRegion({project,token,request=fetch}){
  assert(project&&token,'Project and access token are required');
  const base=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const parents=companyQueryParents(await retainedReadReady(project,token,request));
  const post=async(url,body)=>{
    const response=await request(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    assert.equal(response.status,200,'Company scope query unavailable; keep existing workers running');
    return response.json();
  };
  // A curated edit can move records between the roots during a deployment.
  const {transaction}=await post(base+':beginTransaction',{options:{readOnly:{}}});
  assert(transaction,'Read-only verification transaction is missing');
  try{
    const query=async filters=>(await Promise.all(parents.map(parent=>post(base+(parent?'/'+parent:'')+':runQuery',{
      transaction,structuredQuery:{from:[{collectionId:parent?'records':'companies'}],select:{fields:[{fieldPath:'exchange_region'}]},where:{compositeFilter:{op:'AND',filters}}},
    })))).flatMap(rows=>rows.flatMap(row=>row.document?[row.document]:[]));
    const theme={fieldFilter:{field:{fieldPath:'themeIds'},op:'ARRAY_CONTAINS_ANY',value:{arrayValue:{values:['ai','robotics','space'].map(stringValue=>({stringValue}))}}}};
    const all=await query([theme]);
    const selected=await query([theme,{fieldFilter:{field:{fieldPath:'exchange_region'},op:'EQUAL',value:{stringValue:'US'}}}]);
    assert.equal(new Set(all.map(doc=>doc.name.split('/').at(-1))).size,all.length,'Duplicate retained company IDs');
    const expected=all.filter(doc=>/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(doc.name.split('/').at(-1))).map(doc=>doc.name).sort();
    assert(expected.length>0,'US company scope unexpectedly empty');
    assert.deepEqual(selected.map(doc=>doc.name).sort(),expected,'Incomplete exchange_region backfill; keep existing workers running');
    return {event:'exchange_region_release_verified',themeCompanies:all.length,usCompanies:selected.length};
  }finally{await post(base+':rollback',{transaction});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  execFileSync(process.execPath,['--import','tsx',fileURLToPath(new URL('./verify-company-scope.ts',import.meta.url))],{stdio:'inherit'});
}
