import {createHash,randomUUID} from 'node:crypto';
import type {Firestore,DocumentSnapshot} from 'firebase-admin/firestore';
import {EVENTS_COLLECTION} from '../../events/model';
import {acquireMaintenanceLease,releaseMaintenanceLease} from '../../maintenance-lease';
import {loadCollectionCompanyScope} from '../../company-themes/service';
import {loadNewsSources} from './source-service';
import {analyzeCollectedNews} from './news-analysis-worker';
import {translateCollectedHeadlines,needsHeadlineTranslation} from './headline-translations';
import {calendarCandidate} from '../../calendar/queue';
import {processCalendarSource} from '../../calendar/worker';
import {fetchCalendarArticle} from '../../calendar/article';
import type {CalendarSource} from '../../calendar/model';

export const NEWS_ENRICHMENT_TOPIC='news-article-enrichment-requests';
export const NEWS_ENRICHMENT_SUBSCRIPTION='news-article-enrichment-worker';
const STAGES=['analysis','headline','calendar'] as const;
type Stage=typeof STAGES[number];
export type ArticleTask={version:1;type:'news.article.enrichment.requested';batchId:string;articleId:string;fingerprint:string;stages:Stage[];requestedAt:string};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function articleFingerprint(row:Record<string,unknown>){
  return hash(JSON.stringify([row.type,row.url,row.title,row.sourceId,row.sourceType,row.companyId,row.companyIds,row.publication_date,row.summary]));
}
export function parseArticleTask(input:unknown):ArticleTask{
  const task=input as Partial<ArticleTask>|null;
  if(!task||task.version!==1||task.type!=='news.article.enrichment.requested'
    ||typeof task.articleId!=='string'||! /^[A-Za-z0-9:._-]{1,500}$/.test(task.articleId)
    ||typeof task.batchId!=='string'||!/^article_[a-f0-9]{64}$/.test(task.batchId)
    ||typeof task.fingerprint!=='string'||! /^[a-f0-9]{64}$/.test(task.fingerprint)
    ||!Array.isArray(task.stages)||!task.stages.length||task.stages.length>3||new Set(task.stages).size!==task.stages.length||task.stages.some(s=>!STAGES.includes(s))
    ||typeof task.requestedAt!=='string'||!Number.isFinite(Date.parse(task.requestedAt)))throw new Error('Invalid article enrichment task');
  return {version:1,type:task.type,articleId:task.articleId,batchId:task.batchId,fingerprint:task.fingerprint,stages:STAGES.filter(s=>task.stages!.includes(s)),requestedAt:task.requestedAt};
}
export async function readArticleCandidates(db:Firestore,mapped:ReadonlySet<string>,calendar:boolean,now=Date.now()){
  const events=db.collection(EVENTS_COLLECTION);
  const analysis=(await events.where('newsAnalysisNextCheckAtMs','<=',now).orderBy('newsAnalysisNextCheckAtMs').limit(200).get()).docs;
  const headlines:DocumentSnapshot[]=[];const ids=[...mapped],earliest=new Date(now-30*86400000).toISOString().slice(0,10);
  for(let offset=0;offset<ids.length;offset+=30)headlines.push(...(await events.where('headlineTranslationPending','==',true).where('companyId','in',ids.slice(offset,offset+30)).where('headlineTranslationDate','>=',earliest).orderBy('headlineTranslationDate','desc').limit(40).get()).docs);
  const calendars=calendar?(await events.where('calendarNextCheckAtMs','<=',now).orderBy('calendarNextCheckAtMs').limit(300).get()).docs:[];
  const relevant=(doc:DocumentSnapshot)=>Array.isArray(doc.get('companyIds'))&&doc.get('companyIds').some((id:string)=>mapped.has(id));
  return {analysis:analysis.filter(d=>d.get('type')==='company_news'&&relevant(d)).slice(0,20),
    headline:[...new Map(headlines.map(d=>[d.id,d])).values()].filter(d=>relevant(d)&&needsHeadlineTranslation(d.data()??{})).sort((a,b)=>String(b.get('published_at')??b.get('publication_date')).localeCompare(String(a.get('published_at')??a.get('publication_date')))).slice(0,40),
    calendar:calendars.filter(d=>relevant(d)&&calendarCandidate(d.data()??{})).slice(0,25)};
}
/** Bounded indexed discovery only. No download or AI call runs in this job. */
export async function publishArticleTasks(candidates:Record<Stage,readonly DocumentSnapshot[]>,publish:(task:ArticleTask)=>Promise<unknown>,options:{execution:string;deadline:number;now?:()=>number}){
  const now=options.now??Date.now,requestedAt=new Date(now()).toISOString();
  const pending=new Map<string,{doc:DocumentSnapshot;stages:Stage[]}>();
  for(const stage of STAGES)for(const doc of candidates[stage].slice(0,stage==='analysis'?20:stage==='headline'?40:25)){
    const entry=pending.get(doc.id)??{doc,stages:[]};entry.stages.push(stage);pending.set(doc.id,entry);
  }
  const result={requested:0,failed:0,deferred:0};
  for(const {doc,stages} of pending.values()){
    if(now()+30000>=options.deadline){result.deferred++;continue;}
    const fingerprint=articleFingerprint(doc.data()??{}),batchId='article_'+hash(JSON.stringify([options.execution,doc.id,fingerprint]));
    try{await publish(parseArticleTask({version:1,type:'news.article.enrichment.requested',articleId:doc.id,fingerprint,stages,batchId,requestedAt}));result.requested++;}catch{result.failed++;}
  }
  return result;
}
export async function processArticleTask(input:unknown,db:Firestore,options:{enabled:boolean;calendarEnabled:boolean;now?:()=>number;
  // Tests may substitute the work, while exercising real validation/fencing.
  run?:(doc:DocumentSnapshot,stages:Stage[])=>Promise<Record<string,unknown>>;
}){
  const task=parseArticleTask(input),now=options.now??Date.now;
  if(!options.enabled)throw new Error('Article worker disabled; retain task');
  const ref=db.collection(EVENTS_COLLECTION).doc(task.articleId),lease=db.collection('collectors').doc('article-task-'+hash(task.articleId)),owner=randomUUID();
  if(!await acquireMaintenanceLease(lease,owner,now()))throw new Error('Article enrichment busy; retry');
  try{
    let doc=await ref.get();
    if(!doc.exists||articleFingerprint(doc.data()??{})!==task.fingerprint)return {status:'stale',articleId:task.articleId};
    if(options.run)return await options.run(doc,task.stages);
    const graph=await loadCollectionCompanyScope(db),mapped=new Set(graph.nodes.map(n=>n.id));
    const companyIds=doc.get('companyIds');
    if(!Array.isArray(companyIds)||companyIds.length!==1||!mapped.has(companyIds[0]))return {status:'ineligible',articleId:task.articleId};
    const sources=await loadNewsSources(db),deadline=now()+6*60000,result:Record<string,unknown>={status:'verified',articleId:task.articleId};
    const downloads=new Map<string,Promise<string>>();
    const download=(source:CalendarSource)=>{
      let content=downloads.get(source.url);
      if(!content){content=fetchCalendarArticle(source,undefined,sources);downloads.set(source.url,content);}
      return content;
    };
    for(const stage of task.stages){
      doc=await ref.get();
      if(!doc.exists||articleFingerprint(doc.data()??{})!==task.fingerprint)return {...result,status:'stale'};
      if(now()+95000>=deadline)throw new Error('Article enrichment deadline; retry remaining stages');
      const row=doc.data()!;
      if(stage==='analysis'&&row.type==='company_news'&&Number(row.newsAnalysisNextCheckAtMs)<=now())result.analysis=await analyzeCollectedNews(db,graph.nodes.filter(n=>n.kind==='COMPANY'),sources,{records:[doc],maxCalls:1,deadline,now,download,monthlyBudgetUsd:Number(process.env.NEWS_ANALYSIS_MONTHLY_BUDGET_USD??5)});
      if(stage==='headline'&&needsHeadlineTranslation(row))result.headline=await translateCollectedHeadlines(db,mapped,{records:[doc],deadline,now});
      if(stage==='calendar'&&options.calendarEnabled&&calendarCandidate(row)&&Number(row.calendarNextCheckAtMs)<=now())result.calendar=await processCalendarSource(db,{...row,id:doc.id} as CalendarSource,{sourceSnapshot:doc,now,companyCountries:new Map(graph.nodes.flatMap(n=>n.country?[[n.id,n.country] as const]:[])),download});
    }
    // Terminal paid intents (including uncertain charges) remain durable. Only
    // failed persistence throws for Pub/Sub retry; stage-specific backoff stays.
    return result;
  }finally{await releaseMaintenanceLease(lease,owner);}
}
