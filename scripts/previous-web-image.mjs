import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

/** Pin the serving predecessor by digest, never a mutable image tag. */
export function previousWebImages({service,project,region,command=args=>execFileSync('gcloud',args,{encoding:'utf8'})}){
 const scope=['--project',project,'--region',region,'--format=json'];
 const state=JSON.parse(command(['run','services','describe',service,...scope]));
 const serving=(state.status?.traffic??[]).filter(row=>row.percent>0);
 assert(serving.length===1&&serving[0].percent===100,'Asset retention requires one stable serving revision');
 const revision=JSON.parse(command(['run','revisions','describe',serving[0].revisionName,...scope]));
 assert(revision.metadata?.creationTimestamp,'Serving revision creation time is required');
 const digest=revision=>{
  const image=revision.status?.imageDigest;
  assert(typeof image==='string'&&/^[a-z0-9.-]+\/[A-Za-z0-9_./-]+@sha256:[a-f0-9]{64}$/.test(image),'Serving revision must expose an immutable image digest');
  return image;
 };
 // Bootstrap pages still open from the last rollout, before cumulative retention
 // existed. Later releases already inherit that history through the serving image.
 const retained=new Set(state.status.traffic.filter(row=>row.tag?.startsWith('retain-')).map(row=>row.revisionName));
 const revisions=JSON.parse(command(['run','revisions','list','--service',service,...scope]));
 const older=revisions.filter(row=>retained.has(row.metadata.name)&&row.metadata.creationTimestamp<revision.metadata.creationTimestamp)
  .sort((a,b)=>b.metadata.creationTimestamp.localeCompare(a.metadata.creationTimestamp))[0];
 return {previous:digest(revision),retained:older?digest(older):'empty-assets'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const images=previousWebImages({project:process.argv[2],region:process.argv[3],service:process.argv[4]});
 console.log(`${images.previous} ${images.retained}`);
}
