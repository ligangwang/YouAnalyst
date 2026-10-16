import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const project=process.env.FIRESTORE_PROJECT_ID;
assert(project,'FIRESTORE_PROJECT_ID is required');
// Only the new cache payload exemption; unrelated migration exemptions remain deferred.
execFileSync('gcloud',['firestore','indexes','fields','update','payload',`--project=${project}`,'--collection-group=collectors','--disable-indexes','--quiet'],{stdio:'inherit'});
for(let attempt=0;attempt<80;attempt++){
  const indexes=JSON.parse(execFileSync('gcloud',['firestore','indexes','composite','list',`--project=${project}`,'--format=json'],{encoding:'utf8'}));
  const index=indexes.find(row=>row.name.includes('/collectionGroups/sec_filings/')&&row.fields.filter(field=>field.fieldPath!=='__name__').map(field=>`${field.fieldPath}:${field.order}`).join(',')==='published_at:ASCENDING,filingDate:DESCENDING');
  if(index?.state==='READY'){console.log('Feed cache SEC index is READY.');process.exit(0);}
  if(index?.state==='NEEDS_REPAIR')throw Error('Feed cache index needs repair');
  console.log(`Waiting for feed cache index (${index?.state??'not listed yet'})...`);
  await new Promise(resolve=>setTimeout(resolve,15_000));
}
throw Error('Feed cache index did not become ready within 20 minutes');
