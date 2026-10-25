import {AsyncLocalStorage} from 'node:async_hooks';
import {readSecBulkJson,secBulkTarget,validateSecBulkSnapshot,type SecBulkReader} from './sec-bulk';
import {createSecBulkReader} from './sec-bulk-storage';

const scope=new AsyncLocalStorage<SecBulkReader|undefined>();
/** Preflight outside company failure handling: unavailable snapshots do not poison companies. */
export async function withSecBulkFinancialReads<T>(options:{companyIds:string[];incremental?:boolean;verification?:boolean},work:()=>Promise<T>,reader?:SecBulkReader):Promise<T>{
  if(options.incremental||options.verification||!reader&&process.env.SEC_BULK_FINANCIALS_ENABLED!=='1')return scope.run(undefined,work);
  const source=reader??createSecBulkReader((await import('../firebase/admin')).getAdminStorageBucket(process.env.ENTITY_SNAPSHOT_BUCKET));
  const raw=await source.latest();
  // Additive rollout: before the first successful nightly archive, retain the
  // existing rate-limited acquisition path. A broken published snapshot fails.
  if(!raw)return scope.run(undefined,work);
  const snapshot=validateSecBulkSnapshot(raw),age=Date.now()-Date.parse(snapshot.capturedAt);
  if(age<0||age>36*3600_000)throw Error('SEC bulk snapshot unavailable or stale; company tasks remain queued');
  if(options.companyIds.some(ticker=>!snapshot.companyIds.includes(`US:${ticker}`)))return scope.run(undefined,work);
  return scope.run({latest:async()=>snapshot,read:(...args)=>source.read(...args)},work);
}

export async function scopedSecFinancialJson<T>(url:string,fallback:()=>Promise<T>):Promise<T>{
  const reader=scope.getStore();
  if(!reader||!secBulkTarget(url))return fallback();
  const value=await readSecBulkJson(reader,url);
  if(value===null)throw Error('Selected issuer JSON missing from SEC bulk snapshot');
  return value as T;
}
