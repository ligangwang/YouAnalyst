/** Immutable bulk snapshots contain only the selected issuer JSON objects. */
export const SEC_BULK_PREFIX='sec-financial-bulk/v1/';
export const BULK_RETENTION_DAYS=7;
export type SecBulkKind='companyfacts'|'submissions';
export type SecBulkSnapshot={version:1;id:string;capturedAt:string;companyIds:string[];ciks:string[]};
export interface SecBulkReader {
  latest():Promise<SecBulkSnapshot|null>;
  read(snapshot:SecBulkSnapshot,kind:SecBulkKind,cik:string):Promise<unknown|null>;
}

/** Match only canonical public JSON endpoints, never documents or identity maps. */
export function secBulkTarget(value:string):{kind:SecBulkKind;cik:string}|null{
  const url=new URL(value);
  if(url.origin!=='https://data.sec.gov'||url.username||url.password||url.search||url.hash)return null;
  const match=url.pathname.match(/^\/(api\/xbrl\/companyfacts|submissions)\/CIK(\d{10})\.json$/);
  if(!match||Number(match[2])===0)return null;
  return {kind:match[1]==='submissions'?'submissions':'companyfacts',cik:match[2]};
}

export function validateSecBulkSnapshot(value:unknown):SecBulkSnapshot{
  const s=value as SecBulkSnapshot;
  if(!s||s.version!==1||typeof s.id!=='string'||!/^\d{4}-\d{2}-\d{2}-[a-f0-9]{16}$/.test(s.id)
    ||!Number.isFinite(Date.parse(s.capturedAt))||!Array.isArray(s.companyIds)||!Array.isArray(s.ciks)
    ||s.companyIds.some(id=>typeof id!=='string'||!/^US:[A-Z0-9.-]+$/.test(id))
    ||s.ciks.some(cik=>typeof cik!=='string'||!/^\d{10}$/.test(cik)||Number(cik)===0)
    ||new Set(s.companyIds).size!==s.companyIds.length||new Set(s.ciks).size!==s.ciks.length)throw Error('Invalid SEC bulk snapshot');
  return s;
}

/** A cache miss is explicit. Caller chooses the bounded live/incremental policy. */
export async function readSecBulkJson(reader:SecBulkReader,url:string,options:{now?:number;maxAgeMs?:number;incremental?:boolean}={}):Promise<unknown|null>{
  const target=secBulkTarget(url);
  if(!target||options.incremental)return null;
  const raw=await reader.latest();if(!raw)return null;
  const snapshot=validateSecBulkSnapshot(raw),age=(options.now??Date.now())-Date.parse(snapshot.capturedAt);
  if(age<0||age>(options.maxAgeMs??36*3600_000)||!snapshot.ciks.includes(target.cik))return null;
  const value=await reader.read(snapshot,target.kind,target.cik);
  if(value===null)return null;
  if(!value||typeof value!=='object'||!/^\d{1,10}$/.test(String((value as {cik?:unknown}).cik))
    ||String((value as {cik:unknown}).cik).padStart(10,'0')!==target.cik)throw Error('SEC bulk issuer identity mismatch');
  return value;
}
