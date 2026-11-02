import {parseSecFilingDiscovered,type SecFilingDiscovered,SEC_FILINGS_TOPIC} from './event';
import {secRequest} from '../sec-request';
import {configuredSecDocumentCache,readSecDocumentBytes,secCacheOwner,SecDocumentSizeError,type SecDocumentCache} from './document-cache';
import {secArchiveIdentity} from './document-cache';
import type {Firestore} from 'firebase-admin/firestore';
import {EARNINGS_TOPIC,parseEarningsJob,type EarningsSourceDiscovered} from '../earnings/live-event';
import {EARNINGS_SOURCES,type EarningsWork} from '../earnings/live-store';
import {sourceIdentity} from '../earnings/model';
import {validateSource} from '../earnings/document';
import {isSupportedCompany} from '../company-support/model';
import {reviewedEarningsIssuers,type EarningsCompany} from '../earnings/issuers';

/** Intake needs one current issuer, not the graph and identity-directory listeners.
 * Company deltas update eligibility; the operational identity stays live. Never
 * trust the queued source itself to establish its issuer identity.
 */
export async function readSecIntakeIdentity(db:Firestore,companyId:string):Promise<EarningsCompany>{
  if(!/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(companyId))throw new Error('Invalid SEC intake company');
  // The adapter serves the company projection from the shared directory and
  // reads the operational identity directly from Firestore.
  const [companyDoc,identityDoc]=await db.getAll(db.collection('companies').doc(companyId),db.collection('collectors').doc(`sec-identity-${companyId}`),
    {fieldMask:['name','status','isDeleted','supersededByCompanyId','onboarding.status','companyId','cik']});
  const company=companyDoc.data(),identity=identityDoc.data();
  if(!company||!isSupportedCompany(company))throw new Error('SEC intake company is not supported');
  const cik=identity?.cik;
  if(identity?.companyId!==companyId||typeof cik!=='string'||!/^\d{10}$/.test(cik)||Number(cik)===0)throw new Error('Unverified SEC intake issuer');
  const hint=reviewedEarningsIssuers.find(row=>row.companyId===companyId);
  if(hint?.cik&&hint.cik!==cik)throw new Error('Reviewed issuer CIK changed');
  return {companyId,cik,issuerId:`sec:${cik}`,name:company.name as string,aliases:[],irHosts:[]};
}

export const SEC_DOWNLOAD_TOPIC='sec-filing-download-requests';
export const SEC_DOWNLOAD_SUBSCRIPTION='sec-filing-download-worker';
export const SEC_DOWNLOAD_DEAD_LETTER_TOPIC='sec-filing-download-dead-letter';
export type SecIntakeJob=SecFilingDiscovered|EarningsSourceDiscovered;

/** Deterministically oversized originals need operator review, not 100 downloads.
 * Ack only after the unchanged request reaches the existing retained audit queue. */
export async function deliverSecIntake(input:unknown,db:Firestore,options:Parameters<typeof prepareSecIntake>[2]){
  const event=parseSecIntakeJob(input);
  try{return await prepareSecIntake(event,db,options);}
  catch(error){
    if(!(error instanceof SecDocumentSizeError))throw error;
    await options.publish(SEC_DOWNLOAD_DEAD_LETTER_TOPIC,event);
    return {status:'needs_admin',batchId:event.batchId,reason:error.message,quarantined:true};
  }
}
export function parseSecIntakeJob(input:unknown):SecIntakeJob{
  if((input as {type?:string}|null)?.type==='sec.filing.discovered')return parseSecFilingDiscovered(input);
  const event=parseEarningsJob(input);
  if(event.type!=='earnings.source.discovered')throw new Error('Expected SEC filing or earnings intake');
  return event;
}
export function secFilingDocumentUrl(event:SecFilingDiscovered){
  return `https://www.sec.gov/Archives/edgar/data/${Number(event.cik)}/${event.accessionNumber.replaceAll('-','')}/${event.primaryDocument}`;
}
/** The original event and SEC URLs survive the internal download boundary. */
export async function prepareSecFiling(input:unknown,options:{enabled:boolean;cache?:SecDocumentCache;download?:(url:string)=>Promise<{bytes:Buffer;contentType:string}>;publish:(topic:string,event:SecFilingDiscovered)=>Promise<unknown>}){
  const event=parseSecFilingDiscovered(input);
  if(!options.enabled)throw new Error('SEC downloads disabled; retain delivery');
  const cache=options.cache??configuredSecDocumentCache();if(!cache)throw new Error('SEC document cache bucket is required');
  const owners=[secCacheOwner('fundamentals',event.eventId),...(event.form==='10-K'?[secCacheOwner('graph',event.eventId)]:[])];
  const url=secFilingDocumentUrl(event);
  await cache.read(url,owners,options.download?()=>options.download!(url):()=>{
    if(!process.env.SEC_USER_AGENT)throw new Error('SEC_USER_AGENT required');
    return secRequest(url,{headers:{'user-agent':process.env.SEC_USER_AGENT,accept:'text/html,application/pdf,text/plain'},signal:AbortSignal.timeout(60000)},readSecDocumentBytes,{cik:event.cik,accession:event.accessionNumber,operation:'queued_filing_download'});
  });
  // Publish only after durable storage succeeds. At-least-once fan-out retains
  // the exact eventId already understood by the existing consumers.
  await options.publish(SEC_FILINGS_TOPIC,event);
  return {status:'verified',eventId:event.eventId,companyId:event.companyId};
}

/** Route by validated task kind, never by caller-supplied URLs or destinations. */
export async function prepareSecIntake(input:unknown,db:Firestore,options:{enabled:boolean;cache?:SecDocumentCache;
  download?:(url:string)=>Promise<{bytes:Buffer;contentType:string}>;
  publish:(topic:string,event:SecIntakeJob)=>Promise<unknown>;
  readWork?:(id:string)=>Promise<EarningsWork|undefined>;
}){
  const event=parseSecIntakeJob(input);
  if(event.type==='sec.filing.discovered')return prepareSecFiling(event,options);
  if(!options.enabled)throw new Error('SEC intake disabled; retain delivery');
  const work=await (options.readWork??(id=>db.collection(EARNINGS_SOURCES).doc(id).get().then(doc=>doc.data() as EarningsWork|undefined)))(event.sourceId);
  if(!work||work.recordType!=='source'||work.sourceId!==event.sourceId||sourceIdentity(work.source)!==event.sourceId)throw new Error('SEC earnings intake has no durable source');
  validateSource(work.source,await readSecIntakeIdentity(db,work.source.companyId));
  if(work.generation>event.generation)return {status:'ineligible',stale:true};
  if(work.generation!==event.generation)throw new Error('SEC earnings intake generation is not durable');
  if(work.source.provider!=='sec'||!['sec_filing','document'].includes(work.inputKind))throw new Error('Non-SEC work cannot enter SEC intake');
  const source=work.source,identity=secArchiveIdentity(source.url);
  if(!source.accession||!/^\d{10}-\d{2}-\d{6}$/.test(source.accession)||! /^sec:\d{10}$/.test(source.issuerId)
    ||!identity.prefix.endsWith(`/${Number(source.issuerId.slice(4))}/${source.accession.replaceAll('-','')}/`))throw new Error('SEC earnings issuer/accession mismatch');
  const url=work.inputKind==='sec_filing'?new URL(`${source.accession}-index.html`,source.url).href:source.url;
  const cache=options.cache??configuredSecDocumentCache();if(!cache)throw new Error('SEC intake cache bucket required');
  await cache.read(url,[secCacheOwner('earnings',event.batchId)],options.download?()=>options.download!(url):()=>{
    if(!process.env.SEC_USER_AGENT)throw new Error('SEC_USER_AGENT required');
    return secRequest(url,{headers:{'user-agent':process.env.SEC_USER_AGENT,accept:'text/html,application/pdf,text/plain'},signal:AbortSignal.timeout(60000)},readSecDocumentBytes,{cik:source.issuerId.slice(4),accession:source.accession,operation:'queued_earnings_download'});
  });
  await options.publish(EARNINGS_TOPIC,event);
  return {status:'verified',sourceId:event.sourceId,companyId:source.companyId};
}
