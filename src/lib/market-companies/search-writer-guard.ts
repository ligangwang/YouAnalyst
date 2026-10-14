/** Cleanup is read-only until the live company writers and old in-flight leases are verified. */
export async function verifyCompanySearchWriters({project,region='us-central1',expectedSha,token}:{project:string;region?:string;expectedSha:string;token:string}, fetcher:typeof fetch=fetch) {
  if(!/^[a-z][a-z0-9-]+$/.test(project)||!/^[a-z][a-z0-9-]+$/.test(region)||!/^[a-f0-9]{40}$/.test(expectedSha))throw new Error('Invalid writer verification target');
  const read=async(url:string,missing=false)=>{
    const response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
    if(missing&&response.status===404)return {};
    if(!response.ok)throw new Error(`Company writer verification returned HTTP ${response.status}`);
    return response.json();
  };
  const base=`projects/${project}/locations/${region}`;
  const images=await Promise.all(['ticker-catalog-subscriber','cni-directory-subscriber'].map(async name=>{
    const service=await read(`https://run.googleapis.com/v2/${base}/services/${name}`,name==='ticker-catalog-subscriber');
    if(name==='ticker-catalog-subscriber'&&Object.keys(service).length===0)return null;
    if(service.reconciling||service.generation===undefined||String(service.generation)!==String(service.observedGeneration)
      ||service.terminalCondition?.state!=='CONDITION_SUCCEEDED'||!service.latestReadyRevision||service.latestReadyRevision!==service.latestCreatedRevision)
      throw new Error(`${name} has not completed rollout`);
    const container=service.template?.containers?.[0];
    if(container?.env?.find((item:{name:string;value?:string})=>item.name==='GIT_SHA')?.value!==expectedSha)throw new Error(`${name} still has an older writer template`);
    const traffic=(service.trafficStatuses??[]).filter((item:{percent?:number})=>Number(item.percent)>0);
    if(traffic.reduce((sum:number,item:{percent:number})=>sum+Number(item.percent),0)!==100)throw new Error(`${name} traffic is not verified`);
    for(const target of traffic){
      const revision=target.revision;
      if(typeof revision!=='string'||!revision.startsWith(name+'-')||!/^[a-z0-9-]+$/.test(revision))throw new Error(`${name} has an unknown traffic revision`);
      const live=await read(`https://run.googleapis.com/v2/${base}/services/${name}/revisions/${revision}`);
      const actual=live.containers?.[0];
      if(actual?.env?.find((item:{name:string;value?:string})=>item.name==='GIT_SHA')?.value!==expectedSha||actual?.image!==container.image)
        throw new Error(`${name} still serves an older writer revision`);
    }
    return container.image as string;
  }));
  // The directory publisher also supports direct import; verify its deployed and running images.
  const jobUrl=`https://run.googleapis.com/v2/${base}/jobs/sync-cni-directory-production`;
  const job=await read(jobUrl);
  if(job.reconciling||job.template?.template?.containers?.[0]?.image!==images[1])throw new Error('Directory publisher still uses an older image');
  let pageToken='';
  do {
    const page=await read(jobUrl+'/executions?'+new URLSearchParams({pageSize:'100',...(pageToken?{pageToken}:{})}));
    for(const execution of page.executions??[])if(!execution.completionTime&&execution.template?.containers?.[0]?.image!==images[1])throw new Error('An older directory execution is still running');
    pageToken=page.nextPageToken??'';
  }while(pageToken);
  for(const id of ['CN_A_CNI','TICKER_CATALOG']){
    const state=await read(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/directory_syncs/${id}`,true);
    if(Number(state.fields?.leaseExpiresAtMs?.integerValue??state.fields?.leaseExpiresAtMs?.doubleValue??state.fields?.leaseExpiresAtMs?.stringValue)>Date.now())throw new Error(`${id} company writer is busy; retry cleanup after it finishes`);
  }
}
