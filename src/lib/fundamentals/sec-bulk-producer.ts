import type {Bucket,File,FileMetadata} from '@google-cloud/storage';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import type {ReadableStream as NodeReadableStream} from 'node:stream/web';
import {pipeline} from 'node:stream/promises';
import {SEC_BULK_PREFIX,type SecBulkKind,type SecBulkSnapshot} from './sec-bulk';
import {createSecBulkReader,publishSecBulkSnapshot,saveSecBulkCompany,secBulkSnapshotPrefix} from './sec-bulk-storage';
import {extractSelectedSecZip} from './sec-bulk-zip';

export const SEC_BULK_URLS:Record<SecBulkKind,string>={companyfacts:'https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip',submissions:'https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip'};
const notFound=(error:unknown)=>Number((error as {code?:unknown})?.code)===404;
async function metadata(file:File):Promise<FileMetadata|null>{try{return (await file.getMetadata())[0];}catch(error){if(notFound(error))return null;throw error;}}

/** One SEC request per archive. Stream directly to private GCS, not container RAM. */
export async function downloadSecBulkArchive(bucket:Bucket,path:string,kind:SecBulkKind,userAgent:string,signal:AbortSignal){
  if(!userAgent.trim()||!path.startsWith(SEC_BULK_PREFIX))throw Error('Invalid SEC bulk download configuration');
  const file=bucket.file(path),existing=await metadata(file);
  if(existing){
    if(existing.metadata?.sourceUrl!==SEC_BULK_URLS[kind]||!existing.generation||Number(existing.size)<22)throw Error('Conflicting SEC bulk archive');
    return existing;
  }
  const {secBudget,secCooldownMs}=await import('../sec-budget');
  // The shared request budget covers request admission and headers. Releasing
  // after headers avoids holding its 30s lease during a multi-GB response body.
  const headerAbort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let response:Response;
  try{
    response=await secBudget.run(AbortSignal.any([signal,headerAbort.signal]),async cooldown=>{
      timer=setTimeout(()=>headerAbort.abort(Error('SEC bulk headers timed out')),12_000);
      const response=await fetch(SEC_BULK_URLS[kind],{redirect:'error',signal:AbortSignal.any([signal,headerAbort.signal]),headers:{'user-agent':userAgent,'accept':'application/zip','accept-encoding':'identity'}});
      if(!response.ok){cooldown(secCooldownMs(response.status,response.headers.get('retry-after')));await response.body?.cancel();throw Object.assign(Error(`SEC bulk request failed (${response.status})`),{code:response.status});}
      return response;
    });
  }finally{clearTimeout(timer);}
  if(!response.body||!response.headers.get('content-type')?.includes('zip')){await response.body?.cancel();throw Error('SEC bulk response is not a ZIP');}
  const expected=Number(response.headers.get('content-length')??0);
  if(!Number.isFinite(expected)||expected<0||expected>8*1024**3){await response.body.cancel();throw Error('SEC bulk archive too large');}
  let bytes=0;
  let magic=Buffer.alloc(0);
  const bound=new Transform({transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;if(magic.length<4)magic=Buffer.concat([magic,chunk.subarray(0,4-magic.length)]);callback(bytes>8*1024**3?Error('SEC bulk download byte limit exceeded'):null,chunk);},
    flush(callback){callback(bytes<22||expected&&bytes!==expected?Error('Truncated SEC bulk archive'):magic.toString('hex')!=='504b0304'?Error('Invalid SEC bulk ZIP signature'):null);}});
  await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),bound,file.createWriteStream({resumable:true,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/zip',cacheControl:'private, no-store',temporaryHold:true,metadata:{sourceUrl:SEC_BULK_URLS[kind],sourceModified:response.headers.get('last-modified')??'',downloadedAt:new Date().toISOString()}}}),{signal});
  if(expected&&bytes!==expected)throw Error('Truncated SEC bulk archive');
  return (await file.getMetadata())[0];
}

/** No company writes occur until both official archives are fully extracted. */
export async function prepareSecBulkFinancials(options:{bucket:Bucket;companyIds:string[];userAgent:string;now?:number;signal?:AbortSignal},dependencies:{
  identify?:()=>Promise<Map<string,string>>;download?:typeof downloadSecBulkArchive;extract?:typeof extractSelectedSecZip;
}={}){
  const now=options.now??Date.now(),signal=options.signal??AbortSignal.timeout(15*60_000),companyIds=[...new Set(options.companyIds)].sort();
  if(!companyIds.length||companyIds.some(id=>!/^US:[A-Z0-9.-]+$/.test(id)))throw Error('Invalid SEC bulk company scope');
  const identify=dependencies.identify??(async()=>{
    const {secRequest}=await import('../sec-request'),{parseSecTickerMapping}=await import('../sec-filings/source');
    return secRequest('https://www.sec.gov/files/company_tickers_exchange.json',{headers:{'user-agent':options.userAgent,accept:'application/json'},signal},async response=>parseSecTickerMapping(await response.json()),{operation:'bulk_issuer_scope'});
  });
  const mapping=await identify();
  const ciks=[...new Set(companyIds.map(id=>mapping.get(id.slice(3).replace(/-/g,'.'))).filter((cik):cik is string=>Boolean(cik)))].sort();
  if(!ciks.length)throw Error('No SEC issuers in requested bulk scope');
  const day=new Date(now).toISOString().slice(0,10),id=`${day}-${createHash('sha256').update(JSON.stringify({companyIds,ciks})).digest('hex').slice(0,16)}`;
  const latest=await createSecBulkReader(options.bucket).latest();
  if(latest?.id===id){
    for(const kind of ['companyfacts','submissions'] as const){const file=options.bucket.file(`${secBulkSnapshotPrefix(id)}${kind}.zip`),meta=await metadata(file);if(meta?.temporaryHold)await file.setMetadata({temporaryHold:false});}
    return {snapshot:latest,reused:true};
  }
  const pointer=await metadata(options.bucket.file(`${SEC_BULK_PREFIX}latest.json`)),generation=pointer?.generation??0;
  const archives:Partial<Record<SecBulkKind,FileMetadata>>={};
  try{
  for(const kind of ['companyfacts','submissions'] as const){
    signal.throwIfAborted();
    archives[kind]=await (dependencies.download??downloadSecBulkArchive)(options.bucket,`${secBulkSnapshotPrefix(id)}${kind}.zip`,kind,options.userAgent,signal);
  }
  const capturedAt=[archives.companyfacts!,archives.submissions!].map(m=>String(m.metadata?.downloadedAt??m.timeCreated)).sort()[0];
  const snapshot:SecBulkSnapshot={version:1,id,capturedAt,companyIds,ciks};
  const coverage:Record<string,{entries:number;selected:string[];missing:string[]}>={};
  for(const kind of ['companyfacts','submissions'] as const){
    const meta=archives[kind]!,file=options.bucket.file(`${secBulkSnapshotPrefix(id)}${kind}.zip`,{generation:meta.generation});
    await file.setMetadata({temporaryHold:true});
    coverage[kind]=await (dependencies.extract??extractSelectedSecZip)({file,size:Number(meta.size),ciks:new Set(ciks),signal,save:(cik,bytes)=>saveSecBulkCompany(options.bucket,snapshot,kind,cik,bytes)});
  }
  // Immutable manifests are visible only after all selected JSON writes succeed.
  await publishSecBulkSnapshot(options.bucket,snapshot,generation);
  return {snapshot,reused:false,coverage};
  }finally{
    // Queued company tasks read extracted JSON, never the ZIP. Holds protect
    // active extraction only; abandoned staging stays invisible and expires.
    const releases=await Promise.allSettled((['companyfacts','submissions'] as const).filter(kind=>archives[kind]).map(kind=>options.bucket.file(`${secBulkSnapshotPrefix(id)}${kind}.zip`,{generation:archives[kind]!.generation}).setMetadata({temporaryHold:false})));
    const failed=releases.find(result=>result.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
  }
}
