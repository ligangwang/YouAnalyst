import {taggedReleaseRequest} from './tagged-release-request.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

// Keep the predecessor addressable after promotion. Untagging it immediately can
// retire its routing infrastructure while a traffic update is still propagating.
// Retention is intentionally not removed by this rollout.
export async function promoteRelease({service,project,region,revision,commit,
  command=args=>execFileSync('gcloud',args,{encoding:'utf8'}),request=fetch,
  sleep=ms=>delay(ms),now=()=>Date.now(),samples=12,interval=10000,log=console.log}) {
  assert(service&&project&&region&&revision&&commit,'Release identity required');
  const scope=['--project',project,'--region',region];
  const describe=()=>JSON.parse(command(['run','services','describe',service,...scope,'--format=json']));
  const update=args=>command(['run','services','update-traffic',service,...scope,...args,'--quiet']);
  const initial=describe();
  const serving=(initial.status.traffic??[]).filter(item=>item.percent>0);
  assert(serving.length===1&&serving[0].percent===100,'Expected a single stable serving revision');
  const previous=serving[0].revisionName;
  assert(previous&&previous!==revision,'Candidate must differ from the serving revision');
  const candidate=initial.status.traffic.find(item=>item.tag==='candidate');
  assert(candidate?.revisionName===revision&&candidate.url,'Pinned candidate changed');
  const readableTag=`retain-${previous}`;
  // Cloud Run limits the combined tag + service name to 46 characters.
  // Keep existing readable tags when valid; hash long revision names stably.
  const tag=readableTag.length+service.length<=46?readableTag:
    `retain-${createHash('sha256').update(previous).digest('hex').slice(0,16)}`;
  assert(tag.length+service.length<=46,'Service name leaves no room for predecessor retention tag');
  if(!initial.status.traffic.some(item=>item.tag===tag&&item.revisionName===previous)) {
    update(['--update-tags',`${tag}=${previous}`]);
  }
  const retained=describe().status.traffic.find(item=>item.tag===tag);
  assert(retained?.revisionName===previous&&retained.url,'Predecessor retention was not applied');
  async function publicHealth(requireCandidate=false) {
    const response=await request(`${initial.status.url}/api/health`,{signal:AbortSignal.timeout(30000),cache:'no-store'});
    assert.equal(response.status,200,`Public health failed during rollout: HTTP ${response.status}`);
    const body=await response.json();
    assert.equal(body.status,'ok');
    assert([previous,revision].includes(body.revision),'Unexpected public revision');
    if(body.revision===revision)assert.equal(body.commitSha,commit,'Public commit mismatch');
    if(requireCandidate)assert.equal(body.revision,revision,'Public traffic did not converge to candidate');
  }
  async function health(url,expected,expectedCommit) {
    const response=await taggedReleaseRequest(`${url}/api/health`,{}, {request,sleep,log,beforeRetry:()=>publicHealth()});
    assert.equal(response.status,200,`Tagged health failed for ${expected}: HTTP ${response.status}`);
    const body=await response.json();
    assert.equal(body.status,'ok');assert.equal(body.revision,expected);
    if(expectedCommit)assert.equal(body.commitSha,expectedCommit);
  }
  function active() {
    const value=JSON.parse(command(['run','revisions','describe',previous,...scope,'--format=json']));
    assert(value.status.conditions.some(item=>item.type==='Active'&&item.status==='True'),`Predecessor ${previous} is not active`);
  }
  await health(retained.url,previous);
  await health(candidate.url,revision,commit);
  active();
  let changed=false;
  const started=new Date(now()).toISOString();
  // Bounded log reads supplement probes; a failed read blocks progression.
  function errors() {
    const filter=`resource.type="cloud_run_revision" AND resource.labels.service_name="${service}" AND timestamp>="${started}" AND (httpRequest.status>=500 OR httpRequest.status=429)`;
    const rows=JSON.parse(command(['logging','read',filter,'--project',project,'--limit=1','--format=json']));
    assert.equal(rows.length,0,'HTTP 5xx/429 during rollout; traffic restored to predecessor');
  }
  try {
    // Move the application as one release: splitting Next.js HTML and hashed
    // assets between builds can produce mixed-version pages. Observe both
    // revisions through a drain grace period; keep the predecessor tagged.
    for(const percent of [100]) {
      changed=true;
      update(['--to-revisions',`${revision}=100`]);
      for(let sample=0;sample<samples;sample++) {
        await sleep(interval);
        await health(retained.url,previous);
        await health(candidate.url,revision,commit);
        await publicHealth(sample===samples-1);
        active();
        if(sample%3===2||sample===samples-1)errors();
        log(JSON.stringify({at:new Date(now()).toISOString(),percent,sample:sample+1,previous,revision,predecessorActive:true}));
      }
    }
    log(`Promoted ${revision}; ${previous} retained under ${tag}.`);
  } catch(error) {
    if(changed)update(['--to-revisions',`${previous}=100`]);
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  promoteRelease({service:process.env.RELEASE_SERVICE,project:process.env.GOOGLE_CLOUD_PROJECT,
    region:process.env.GOOGLE_CLOUD_REGION||'us-central1',revision:process.env.CANDIDATE_REVISION,commit:process.env.GIT_SHA})
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
