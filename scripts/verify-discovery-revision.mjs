import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export function verifyDiscoveryRevision(value, mode, env=process.env) {
  const revision=env.DISCOVERY_RELEASE_REVISION;
  assert(revision && /^[a-f0-9]{40}$/.test(env.GIT_SHA??''),'Missing exact release identity');
  if(mode==='revision') {
    const container=value.spec?.containers?.[0];
    assert.equal(value.metadata?.name,revision,'Wrong candidate revision');
    assert.equal(container?.image,env.DISCOVERY_RELEASE_IMAGE,'Wrong candidate image');
    assert.equal(value.spec?.serviceAccountName,env.DISCOVERY_RELEASE_ACCOUNT,'Wrong runtime account');
    assert.deepEqual(container?.command,['node']);
    assert.deepEqual(container?.args,[`dist/${env.DISCOVERY_RELEASE_BUNDLE}.cjs`]);
    assert(container?.env?.some(x=>x.name==='GIT_SHA'&&x.value===env.GIT_SHA),'Wrong candidate commit');
    assert(value.status?.conditions?.some(x=>x.type==='Ready'&&x.status==='True'),'Candidate not ready');
  } else {
    const traffic=value.status?.traffic??[];
    if(mode==='candidate') {
      const candidate=traffic.find(x=>x.tag==='candidate');
      assert.equal(candidate?.revisionName,revision,'Candidate tag points to an older revision');
      assert(/^https:\/\//.test(candidate?.url??''),'Missing candidate URL');
      return candidate.url;
    }
    assert.equal(mode,'traffic');
    const active=traffic.filter(x=>x.percent>0);
    assert.equal(active.length,1,'Unexpected split traffic');
    assert.equal(active[0]?.revisionName,revision,'Old revision still serving');
    assert.equal(active[0]?.percent,100,'Incomplete promotion');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  let input='';
  for await(const chunk of process.stdin)input+=chunk;
  const result=verifyDiscoveryRevision(JSON.parse(input),process.argv[2]);
  if(result)console.log(result);
}
