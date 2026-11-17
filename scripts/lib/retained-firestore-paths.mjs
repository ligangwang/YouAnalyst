import assert from 'node:assert/strict';
export async function retainedReadReady(project,token,request=fetch){
  const response=await request(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/collectors/_market_parquet_retained_control`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  if(response.status===404)return false;
  assert.equal(response.status,200,'Retained-state control is unavailable');
  const fields=(await response.json()).fields??{};
  const ready=fields.ready?.booleanValue,cleanup=fields.cleanupAuthorized?.booleanValue;
  assert(fields.version?.integerValue==='1'&&typeof ready==='boolean'&&typeof cleanup==='boolean'&&(!cleanup||ready),'Invalid retained-state control');
  return ready;
}
export const eodLeasePath=(market,ready)=>`${ready?'market_state/eod_runs/records':'eod_runs'}/_queue_${market}`;
export const companyQueryParents=ready=>ready?['market_state/companies','market_ugc/companies']:[''];
