import {randomUUID} from 'node:crypto';
import {FieldPath,type Firestore,type DocumentSnapshot} from 'firebase-admin/firestore';
import {EVENTS_COLLECTION,eventDocumentId} from '../../events/model';
import {canonicalEvidenceUrl} from '../model';
import {fetchCalendarArticle} from '../../calendar/article';
import type {CalendarSource} from '../../calendar/model';
import type {GraphNode} from '../../knowledge-graph/model';
import {buildOpenAiUsageEvent} from '../../openai/usage';
import type {NewsSource} from './sources';
import {approvedNewsUrl} from './news';
import {NEWS_ANALYSIS_VERSION,NEWS_ANALYSIS_MODEL,articleHash,companyCatalog,analyzeNewsArticle,validateNewsAnalysis,type NewsAnalysisResponse} from './news-analysis';

type Options={deadline:number;now?:()=>number;maxCalls?:number;monthlyBudgetUsd?:number;records?:DocumentSnapshot[];download?:(source:CalendarSource)=>Promise<string>;analyze?:(title:string,content:string,companies:readonly GraphNode[])=>Promise<NewsAnalysisResponse>};
/** Existing event receipts hold reusable article snapshots. New edges are review
 * candidates in the existing relationship collection, never auto-published. */
export async function analyzeCollectedNews(db:Firestore,companies:readonly GraphNode[],sources:readonly NewsSource[],options:Options){
 const now=options.now??Date.now,result={scanned:0,paid:0,complete:0,candidates:0,cached:0,failed:0,deferred:0,budgetBlocked:0};
 if(!options.analyze&&!process.env.OPENAI_API_KEY)return {...result,disabled:true};
 const monthlyBudget=options.monthlyBudgetUsd??5;
 if(!Number.isFinite(monthlyBudget)||monthlyBudget<=0||monthlyBudget>100)throw new Error('Invalid news analysis budget');
 const events=db.collection(EVENTS_COLLECTION),meta=db.collection('collectors').doc('news-article-analysis');
 let records:DocumentSnapshot[],history:DocumentSnapshot[]=[],after='';
 if(options.records)records=options.records;
 else{
  const state=(await meta.get()).data();after=String(state?.afterEventId??'');
  const query=events.where('type','==','company_news').orderBy(FieldPath.documentId()).limit(200);
  const [recent,page]=await Promise.all([events.where('type','==','company_news').orderBy('publication_date','desc').limit(100).get(),(after?query.startAfter(after):query).get()]);
  history=page.docs;records=[...new Map([...recent.docs,...history].map(doc=>[doc.id,doc])).values()];
 }
 const processed=new Set<string>();
 for(const doc of records){
  if(now()+95_000>=options.deadline||result.paid>=(options.maxCalls??20)){result.deferred++;break;}
  const source={...doc.data(),id:doc.id} as CalendarSource;
  if(source.type!=='company_news'){processed.add(doc.id);continue;}
  result.scanned++;
  const config=sources.find(s=>s.id===source.sourceId&&s.companyId===(source.companyId??source.companyIds?.[0]));
  const url=canonicalEvidenceUrl(source.url);
  // Revalidate original URL and each redirect through the existing publisher adapter.
  if(!url||!config||!approvedNewsUrl(url,config,true)){result.failed++;processed.add(doc.id);continue;}
  const receipt=events.doc(eventDocumentId('news_analysis',articleHash(url))),prior=(await receipt.get()).data();
  if(prior&&prior.status!=='fetch_failed'){result.cached++;processed.add(doc.id);continue;}
  if(prior?.nextCheckAtMs>now()){result.cached++;processed.add(doc.id);continue;}
  let content:string;
  try{content=await (options.download??(s=>fetchCalendarArticle(s,undefined,sources)))(source);if(content.length<100||content.length>60_000)throw new Error('Article text unavailable or exceeds analysis limit');}
  catch{
   await db.runTransaction(async tx=>{const old=(await tx.get(receipt)).data();if(old&&old.status!=='fetch_failed')return;tx.set(receipt,{type:'news_analysis',version:1,extractorVersion:NEWS_ANALYSIS_VERSION,status:'fetch_failed',sourceEventId:source.id,sourceUrl:url,companyIds:source.companyIds,title:source.title,nextCheckAtMs:now()+86400_000,updatedAt:new Date(now()).toISOString()},{merge:true});});
   result.failed++;processed.add(doc.id);continue;
  }
  const attemptId=randomUUID(),at=new Date(now()).toISOString(),contentHash=articleHash(content),budget=db.collection('collectors').doc('news-analysis-budget-'+at.slice(0,7));
  // UTF-8 bytes conservatively bound input tokens; reserve maximum output too.
  const reservation=Math.ceil((Buffer.byteLength(JSON.stringify({title:source.title,content,companies:companyCatalog(companies)}))+3000)*.1+8000*.5);
  const claimed=await db.runTransaction(async tx=>{
   const old=(await tx.get(receipt)).data(),spend=(await tx.get(budget)).data();
   if(old&&old.status!=='fetch_failed')return 'cached';
   if(Number(spend?.spentMicros??0)+Number(spend?.reservedMicros??0)+reservation>monthlyBudget*1e6)return 'budget';
   tx.set(budget,{spentMicros:Number(spend?.spentMicros??0),reservedMicros:Number(spend?.reservedMicros??0)+reservation,monthlyBudgetUsd:monthlyBudget},{merge:true});
   tx.set(receipt,{type:'news_analysis',version:1,extractorVersion:NEWS_ANALYSIS_VERSION,status:'requesting',sourceEventId:source.id,sourceUrl:url,companyIds:source.companyIds,title:source.title,content,contentHash,model:NEWS_ANALYSIS_MODEL,attemptId,reservationMicros:reservation,createdAt:at});return 'claimed';
  });
  if(claimed==='budget'){result.budgetBlocked++;result.deferred++;break;}
  if(claimed==='cached'){result.cached++;processed.add(doc.id);continue;}
  result.paid++;let response:NewsAnalysisResponse|null=null,error:string|null=null,analysis:ReturnType<typeof validateNewsAnalysis>|null=null;
  try{response=await (options.analyze??((title,text,nodes)=>analyzeNewsArticle(title,text,nodes,{key:process.env.OPENAI_API_KEY??''})))(source.title,content,companies);analysis=validateNewsAnalysis(response.analysis,content,companies);}
  catch{error=response?'Analysis needs evidence or identity review':'Provider request failed; billing may be unknown. Operator review required before retry.';result.failed++;}
  const usage=buildOpenAiUsageEvent({purpose:'news_article_analysis',model:response?.model??NEWS_ANALYSIS_MODEL,responseId:response?.responseId??'news_analysis_'+attemptId,usage:response?.usage??null,metadata:{sourceEventId:source.id,contentHash,status:analysis?'complete':'review_required'}});
  // Candidate IDs are source-specific observations; they cannot replace reviewed edges.
  const candidates=[...new Map((analysis?.relationships??[]).filter(r=>r.sourceId&&r.targetId&&r.confidence>=.7).map(r=>({id:'news:'+articleHash([url,r.sourceId,r.targetId,r.type].join('|')),relationship:r})).map(candidate=>[candidate.id,candidate])).values()];
  await db.runTransaction(async tx=>{
   const old=(await tx.get(receipt)).data(),spend=(await tx.get(budget)).data(),current=await tx.get(doc.ref);
   const refs=candidates.map(c=>db.collection('company_relationships').doc(c.id)),existing=refs.length?await tx.getAll(...refs):[];
   const usageRef=db.collection('openai_usage_events').doc(usage.id),oldUsage=await tx.get(usageRef);
   if(old?.attemptId!==attemptId||old.status!=='requesting')throw new Error('News analysis ownership changed');
   if(!oldUsage.exists)tx.create(usageRef,usage);
   // Unknown charges keep the reservation, preventing automatic duplicate spend.
   if(usage.estimatedCostUsd!==null)tx.set(budget,{spentMicros:Number(spend?.spentMicros??0)+Math.ceil(usage.estimatedCostUsd*1e6),reservedMicros:Math.max(0,Number(spend?.reservedMicros??0)-reservation)},{merge:true});
   const unchanged=current.exists&&current.data()?.url===source.url&&current.data()?.title===source.title;
   tx.update(receipt,{status:analysis?'complete':'review_required',analysis:analysis??response?.analysis??null,error,usageEventId:usage.id,responseId:response?.responseId??null,updatedAt:at});
   if(unchanged)tx.update(doc.ref,{newsAnalysis:{receiptId:receipt.id,version:NEWS_ANALYSIS_VERSION,status:analysis?'complete':'review_required',contentHash,candidateCount:candidates.length,checkedAt:at}});
   if(unchanged)candidates.forEach((c,i)=>{
    if(existing[i].exists)return;
    const r=c.relationship;
    tx.create(refs[i],{id:c.id,recordKind:'NEWS_OBSERVATION',status:'NEEDS_REVIEW',source:r.sourceId,target:r.targetId,type:r.type,summary:r.summaryEn,summaryTranslations:{'zh-CN':{source:r.summaryEn,text:r.summaryZh,translatedAt:at}},commercialStatus:r.state,confidence:r.confidence,product:r.product,eventDate:r.eventDate,sourceEventId:source.id,analysisReceiptId:receipt.id,contentHash,createdAt:at,evidence:[{id:receipt.id,url,title:source.title,sourceDate:source.publication_date,summary:r.evidence}]});
   });
  });
  if(analysis){result.complete++;result.candidates+=candidates.length;}
  processed.add(doc.id);
 }
 if(!options.records){
  let consumed=0;for(const doc of history){if(!processed.has(doc.id))break;after=doc.id;consumed++;}
  if(consumed===history.length&&history.length<200)after='';
  await meta.set({afterEventId:after,extractorVersion:NEWS_ANALYSIS_VERSION,lastRunAt:new Date(now()).toISOString(),result},{merge:true});
 }
 return result;
}
