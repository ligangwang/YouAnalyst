import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const project=process.env.GCP_PROJECT_ID;
assert(project, 'GCP_PROJECT_ID is required');
const token=process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim();
async function query(filters) {
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:runQuery`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({structuredQuery:{from:[{collectionId:'companies'}],select:{fields:[{fieldPath:'exchange_region'}]},where:{compositeFilter:{op:'AND',filters}}}}),
    signal:AbortSignal.timeout(60000),
  });
  assert.equal(response.status,200,'Company scope index/query unavailable; keep existing workers running');
  return (await response.json()).flatMap(row=>row.document?[row.document]:[]);
}
const theme={fieldFilter:{field:{fieldPath:'themeIds'},op:'ARRAY_CONTAINS_ANY',value:{arrayValue:{values:['ai','robotics','space'].map(stringValue=>({stringValue}))}}}};
// Bounded release validation only, never a scheduled job's company selector.
const all=await query([theme]);
const selected=await query([theme,{fieldFilter:{field:{fieldPath:'exchange_region'},op:'EQUAL',value:{stringValue:'US'}}}]);
const expected=all.filter(doc=>/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(doc.name.split('/').at(-1))).map(doc=>doc.name).sort();
assert(expected.length>0,'US company scope unexpectedly empty');
assert.deepEqual(selected.map(doc=>doc.name).sort(),expected,'Incomplete exchange_region backfill; keep existing workers running');
console.log(JSON.stringify({event:'exchange_region_release_verified',themeCompanies:all.length,usCompanies:selected.length}));
