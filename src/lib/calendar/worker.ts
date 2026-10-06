import { randomUUID } from 'node:crypto';
import { FieldPath, type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { EVENTS_COLLECTION, eventDocumentId } from '../events/model';
import { buildOpenAiUsageEvent, type OpenAiUsageEvent } from '../openai/usage';
import { canonicalEvidenceUrl } from '../intelligence/model';
import { isCalendarCandidate } from './candidates';
import { fetchCalendarArticle } from './article';
import {loadNewsSources} from '../intelligence/collectors/source-service';
import { extractSchedule, hash, normalizedText, normalizeSchedules, type CalendarResponse } from './extraction';
import { CALENDAR_MODEL, CALENDAR_EXTRACTOR_VERSION, type CalendarSource, type ScheduledEvent } from './model';

type Receipt = {status:'requesting'|'complete'|'review_required'|'failed';companyIds:string[];contentHash:string;model:string;output?:string;responseStatus?:string;attemptId:string;createdAt:string;error?:string|null};
type SourceState = {receiptId?:string;nextCheckAtMs?:number;failures?:number;lastError?:string|null};
type Dependencies = {now?:()=>number;download?:(source:CalendarSource)=>Promise<string>;extract?:(source:CalendarSource,text:string)=>Promise<CalendarResponse>;onPaidRequest?:()=>void;revalidateCached?:boolean};

/** A paid-request intent survives crashes. An uncertain request is never retried automatically. */
export async function processCalendarSource(db: Firestore, source: CalendarSource, options: Dependencies = {}) {
  const now=options.now??Date.now,ref=db.collection(EVENTS_COLLECTION).doc(source.id);
  const state=(await ref.get()).get('calendarExtraction') as SourceState|undefined;
  if (options.revalidateCached ? !state?.receiptId : Number(state?.nextCheckAtMs)>now()) return {status:'cached'};
  let text: string;
  try { text=await (options.download??(async item=>fetchCalendarArticle(item,undefined,await loadNewsSources(db))))(source); }
  catch(error) {
    const failures=(state?.failures??0)+1;
    await ref.set({calendarExtraction:{...state,failures,lastError:error instanceof Error?error.message:'Article fetch failed',nextCheckAtMs:now()+Math.min(24,2**Math.min(5,failures))*3600000}},{merge:true});
    return {status:'fetch_failed'};
  }
  const url=canonicalEvidenceUrl(source.url);if(!url)throw new Error('Invalid calendar source URL');
  const contentHash=hash(normalizedText(text)),receiptId=eventDocumentId('calendar_extraction',hash(`${url}|${contentHash}`)),receiptRef=db.collection(EVENTS_COLLECTION).doc(receiptId);
  let at=new Date(now()).toISOString();
  const model=process.env.OPENAI_CALENDAR_MODEL?.trim()||CALENDAR_MODEL;
  const attemptId=randomUUID();
  const reservation=await db.runTransaction(async tx=>{
    const doc=await tx.get(receiptRef);
    if(doc.exists)return {created:false,receipt:doc.data() as Receipt};
    if(options.revalidateCached)return {created:false,receipt:null};
    const receipt:Receipt={status:'requesting',companyIds:source.companyIds,contentHash,model,attemptId,createdAt:at};
    tx.create(receiptRef,{...receipt,type:'calendar_extraction',version:1,sourceUrl:url,sourceEventId:source.id,companyIds:source.companyIds,extractorVersion:CALENDAR_EXTRACTOR_VERSION});
    return {created:true,receipt};
  });
  if(!reservation.receipt)return {status:'cached'};
  let receipt=reservation.receipt,usage:OpenAiUsageEvent|undefined;
  if(receipt.companyIds.join('|')!==source.companyIds.join('|')) return {status:'review_required'};
  if(reservation.created) {
    options.onPaidRequest?.();
    try {
      const response=await (options.extract??((s,t)=>extractSchedule(s,t,{key:process.env.OPENAI_API_KEY??'',model})))(source,text);
      usage=buildOpenAiUsageEvent({purpose:'earnings_calendar_extraction',model:response.model,responseId:response.id??`calendar_${attemptId}`,usage:response.usage,
        metadata:{companyId:source.companyIds[0],ticker:source.companyIds[0].split(':')[1],sourceEventId:source.id,sourceUrl:url,contentHash,extractorVersion:CALENDAR_EXTRACTOR_VERSION,status:response.status}});
      if(!response.usage)usage.estimatedCostUsd=null;
      receipt={...receipt,model:response.model,status:response.status==='completed'?'complete':'review_required',output:response.output.slice(0,20000),responseStatus:response.status};
    } catch(error) {
      receipt={...receipt,status:'failed',error:error instanceof Error?error.message:'Calendar request failed'};
      usage=buildOpenAiUsageEvent({purpose:'earnings_calendar_extraction',model,responseId:`calendar_${attemptId}`,usage:null,metadata:{companyId:source.companyIds[0],sourceEventId:source.id,status:'request_failed',billing:'unknown'}});
      usage.estimatedCostUsd=null;
    }
  } else if(receipt.status==='requesting') {
    return {status:'busy_or_uncertain'};
  }
  at=new Date(now()).toISOString();
  let schedules:ScheduledEvent[]=[];
  if(receipt.status==='complete' || receipt.status==='review_required' && receipt.responseStatus==='completed' && receipt.output) {
    try { schedules=normalizeSchedules(JSON.parse(receipt.output??''),source,text,contentHash,receipt.model,at);receipt={...receipt,status:'complete',error:null}; }
    catch(error) { receipt={...receipt,status:'review_required',error:error instanceof Error?error.message:'Invalid schedule'}; }
  }
  if(usage){usage.metadata.validationStatus=receipt.status;usage.metadata.validationError=receipt.error??null;}
  // Retry only persistence after a provider response, never the paid request.
  const persist=()=>db.runTransaction(async tx=>{
    const current=await tx.get(receiptRef);
    if(!current.exists || current.get('attemptId')!==receipt.attemptId)throw new Error('Calendar request fence changed');
    const newIds=new Set(schedules.map(item=>item.id));
    const oldIds=(current.get('eventIds')??[]) as string[];
    const refs=[...new Set([...newIds,...oldIds])].map(id=>db.collection(EVENTS_COLLECTION).doc(id));
    const previous=refs.length?await tx.getAll(...refs):[];
    const previousById=new Map(previous.map(doc=>[doc.id,doc]));
    const retired=previous.filter(doc=>doc.exists && !newIds.has(doc.id));
    const otherIds=[...new Set(retired.flatMap(doc=>(doc.get('sourceEventIds') as string[]??[]).filter(id=>id!==source.id)))];
    const otherSources=otherIds.length?await tx.getAll(...otherIds.map(id=>db.collection(EVENTS_COLLECTION).doc(id))):[];
    const otherReceiptIds=[...new Set(otherSources.map(doc=>doc.get('calendarExtraction.receiptId')).filter((id):id is string=>typeof id==='string'))];
    const otherReceipts=otherReceiptIds.length?await tx.getAll(...otherReceiptIds.map(id=>db.collection(EVENTS_COLLECTION).doc(id))):[];
    const supports=otherReceipts.filter(doc=>doc.get('status')==='complete').flatMap(doc=>(doc.get('validatedSchedules')??[]) as ScheduledEvent[]);
    const usageId=usage?.id??current.get('usageEventId');
    const usageRef=usageId?db.collection('openai_usage_events').doc(usageId):null;
    const previousUsage=usageRef?await tx.get(usageRef):null;
    schedules.forEach(item=>{
      const old=previousById.get(item.id)?.data() as ScheduledEvent|undefined;
      const sourceEventIds=[...new Set([...(old?.sourceEventIds??[]),source.id])];
      // Older backfill must not undo a later rescheduling/cancellation.
      const older=old && old.type==='scheduled_event' && (old.announcement_date>item.announcement_date || old.announcement_date===item.announcement_date
        && old.published_at && item.published_at && Date.parse(old.published_at)>Date.parse(item.published_at));
      tx.set(db.collection(EVENTS_COLLECTION).doc(item.id),older?{...old,sourceEventIds}:{...item,sourceEventIds,collected_at:old?.collected_at??item.collected_at});
    });
    for(const doc of retired){
      const old=doc.data() as ScheduledEvent;
      const remaining=(old.sourceEventIds??[]).filter(id=>id!==source.id);
      const supported=supports.filter(item=>item.id===doc.id).sort((a,b)=>`${a.announcement_date}|${a.published_at??''}`.localeCompare(`${b.announcement_date}|${b.published_at??''}`)).at(-1);
      // Older receipts lack snapshots. Keep their existing data only when it
      // comes from a different, independently complete original source.
      const legacySupported=old.url!==source.url && otherReceipts.some(receipt=>receipt.get('status')==='complete' && receipt.get('sourceUrl')===old.url);
      tx.set(doc.ref,supported?{...supported,sourceEventIds:remaining,collected_at:old.collected_at}:
        {...old,sourceEventIds:remaining,type:legacySupported?'scheduled_event':'calendar_review'});
    }
    if(usageRef && usage && !previousUsage?.exists)tx.create(usageRef,usage);
    else if(usageRef && previousUsage?.exists)tx.set(usageRef,{metadata:{validationStatus:receipt.status,validationError:receipt.error??null}},{merge:true});
    tx.set(receiptRef,{...receipt,processed_at:at,eventIds:schedules.map(item=>item.id),validatedSchedules:schedules,...(usage?{usageEventId:usage.id}:{})},{merge:true});
    const future=schedules.some(item=>item.scheduled_date>=at.slice(0,10));
    const recent=source.publication_date && Date.parse(source.publication_date)>=now()-60*86400000;
    tx.set(ref,{calendarExtraction:{receiptId,contentHash,status:receipt.status,checkedAt:at,nextCheckAtMs:future||recent||receipt.status!=='complete'?now()+86400000:Number.MAX_SAFE_INTEGER,failures:0,lastError:receipt.error??null}},{merge:true});
  });
  for(let attempt=0;;attempt++)try { await persist();break; } catch(error) { if(attempt>=2)throw error; }
  return {status:receipt.status,created:schedules.length,paid:reservation.created};
}

/** Existing hourly news job scans original IR and exchange sources for the entire mapped union. */
export async function collectCalendarSchedules(db: Firestore, companyIds: Set<string>, options: Dependencies & {deadline:number;maxCalls?:number} ) {
  if(!options.revalidateCached){
    if(process.env.OPENAI_CALENDAR_MODEL && process.env.OPENAI_CALENDAR_MODEL!==CALENDAR_MODEL)throw new Error('Calendar extraction model must be gpt-6-luna');
    if(!options.extract && !process.env.OPENAI_API_KEY)throw new Error('Calendar extraction API key is not configured');
  }
  const now=options.now??Date.now,meta=db.collection('collectors').doc('earnings-calendar'),state=(await meta.get()).data();
  const base=db.collection(EVENTS_COLLECTION);
  let all:DocumentSnapshot[],historyDocs:DocumentSnapshot[]=[],historySize=0,revalidationDocs:DocumentSnapshot[]=[];
  if(options.revalidateCached){
    const query=base.where('type','==','calendar_extraction').orderBy(FieldPath.documentId()).limit(300);
    const receipts=await (state?.revalidationAfterReceiptId?query.startAfter(state.revalidationAfterReceiptId):query).get();
    revalidationDocs=receipts.docs;
    const sourceIds=[...new Set(receipts.docs.filter(doc=>['complete','review_required'].includes(doc.get('status')) && doc.get('responseStatus')==='completed')
      .map(doc=>doc.get('sourceEventId')).filter((id):id is string=>typeof id==='string'))];
    all=sourceIds.length?await db.getAll(...sourceIds.map(id=>base.doc(id))):[];
  }else{
    const historyQuery=base.where('type','in',['company_news','company_disclosure']).orderBy(FieldPath.documentId()).limit(300);
    const [news,exchange,history]=await Promise.all([
      base.where('type','==','company_news').orderBy('publication_date','desc').limit(100).get(),
      base.where('type','==','company_disclosure').where('sourceType','==','exchange').orderBy('publication_date','desc').limit(100).get(),
      (state?.afterEventId?historyQuery.startAfter(state.afterEventId):historyQuery).get(),
    ]);
    historyDocs=history.docs;historySize=history.size;
    all=[...new Map([...news.docs,...exchange.docs,...history.docs].map(doc=>[doc.id,doc])).values()];
  }
  const result={scanned:0,paid:0,complete:0,review_required:0,failed:0,cached:0,deferred:0};
  let afterEventId=String(state?.afterEventId??'');
  const processedIds=new Set<string>();
  for(const doc of all) {
    if(now()+110_000>=options.deadline || result.paid>=(options.maxCalls??25)) {result.deferred++;break;}
    if(!doc.exists){processedIds.add(doc.id);continue;}
    const source={...doc.data(),id:doc.id} as CalendarSource;result.scanned++;
    if(source.companyIds?.length===1 && companyIds.has(source.companyIds[0]) && ['company_ir','exchange'].includes(source.sourceType)
      && source.publication_date && source.publication_date>='2026-01-01' && isCalendarCandidate(source.title,source.summary)) {
      try {
        const outcome=await processCalendarSource(db,source,{...options,onPaidRequest:()=>{result.paid++;options.onPaidRequest?.();}});
        if(outcome.status==='complete')result.complete++;
        else if(outcome.status==='review_required'||outcome.status==='busy_or_uncertain')result.review_required++;
        else if(outcome.status==='cached')result.cached++;
        else result.failed++;
      } catch(error) {result.failed++;console.warn('Calendar extraction persistence failed',{sourceEventId:source.id,error:error instanceof Error?error.message:'Failed'});}
    }
    processedIds.add(doc.id);
  }
  if(options.revalidateCached){
    let afterReceiptId=String(state?.revalidationAfterReceiptId??'');
    for(const doc of revalidationDocs){
      if(['complete','review_required'].includes(doc.get('status')) && doc.get('responseStatus')==='completed'
        && typeof doc.get('sourceEventId')==='string' && !processedIds.has(doc.get('sourceEventId')))break;
      afterReceiptId=doc.id;
    }
    if(revalidationDocs.length<300 && revalidationDocs.at(-1)?.id===afterReceiptId || !revalidationDocs.length)afterReceiptId='';
    if(afterReceiptId)result.deferred++;
    await meta.set({lastRevalidationAt:new Date(now()).toISOString(),revalidationAfterReceiptId:afterReceiptId,revalidation:result},{merge:true});return result;
  }
  // Advance only through a contiguous prefix of the ordered history page.
  for(const doc of historyDocs) {if(!processedIds.has(doc.id))break;afterEventId=doc.id;}
  if(historyDocs.every(doc=>processedIds.has(doc.id)) && historySize<300)afterEventId='';
  await meta.set({lastRunAt:new Date(now()).toISOString(),afterEventId,model:CALENDAR_MODEL,extractorVersion:CALENDAR_EXTRACTOR_VERSION,
    status:result.deferred||afterEventId?'collecting':result.failed||result.review_required?'partial':'complete',result},{merge:true});
  return result;
}
