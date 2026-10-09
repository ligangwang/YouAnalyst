import type { KnowledgeGraph } from '../knowledge-graph/model';

export const INTELLIGENCE_SOURCES = ['SEC','IR','Exchange','GitHub','X','Reddit','Other'] as const;
export type IntelligenceSource = typeof INTELLIGENCE_SOURCES[number];
export type IntelligenceEvidence = { id:string; url:string; title:string; sourceDate:string|null; channel:IntelligenceSource };
export type IntelligenceCalendarEvent = { id:string; companyId:string; day:string; validationWarning?:boolean };
export type IntelligenceEvent = {
  id:string; origin:string; companyIds:string[]; edgeIds:string[]; category:'FILING'|'RESEARCH'|'BUSINESS';
  title:string; titleZh?:string; titleEn?:string; summary:string; published_at:string|null; publication_date:string; eventDate:string|null;
  evidence:IntelligenceEvidence[]; planned:boolean;
  calendarEvents?:IntelligenceCalendarEvent[];
};
export function intelligenceEventTitle(event:Pick<IntelligenceEvent,'title'|'titleZh'|'titleEn'|'evidence'>,locale:string){
  if(event.evidence.some(source=>source.channel==='SEC')){
    const filing=event.title.match(/^(.+) · (4|144)(\/A)? filing$/);
    if(filing){const label=filing[2]==='4'?(locale==='zh-CN'?'内部人交易':'Insider trade'):(locale==='zh-CN'?'拟进行的内部人出售':'Planned insider sale');return `${filing[1]} · ${label} (Form ${filing[2]}${filing[3]??''})`;}
  }
  if(locale!=='zh-CN')return event.titleEn?.trim()||event.title;
  if(event.titleZh?.trim())return event.titleZh;
  if(event.evidence.some(source=>source.channel==='SEC'))return event.title.replace(/ · (.+) filing$/, ' · $1 申报').replace(/ · Earnings announcement$/, ' · 业绩公告');
  return event.title;
}
export type IntelligenceSourceDocument = {id:string;channel:IntelligenceSource;companyIds:string[];published_at:string|null;publication_date:string};
export type IntelligenceSnapshot = { eventReturns?: Record<string,import("./price-performance").EventPriceReturn[]>;
  theme?: import('../company-themes/model').CompanyThemeId;
  graph:KnowledgeGraph; graphVersion:string; events:IntelligenceEvent[]; generatedAt:string;
  session:{date:string;timeZone:'America/New_York';startAt:string;endAt:string};
  coverage:{channel:IntelligenceSource;status:'connected'|'stored_evidence'|'unavailable'}[];
  newsCoverage?:{configured:number;healthy:number;total:number};
  sourceDocuments?:IntelligenceSourceDocument[]; statisticsComplete?:boolean;
  warnings:string[]; truncated:boolean; limit:number;
};

export function easternDate(date:Date) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}

/** Date-only source/review dates never acquire a made-up intraday time. */
export function observation(value:unknown):{at:string|null;day:string}|null {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value).toISOString().slice(0,10)===value)return {at:null,day:value};
  if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  if(new Date(value.slice(0,10)).toISOString().slice(0,10)!==value.slice(0,10))return null;
  const date=new Date(value);
  return {at:date.toISOString(),day:easternDate(date)};
}

function midnight(day:string) {
  const wall=Date.parse(`${day}T00:00:00Z`);
  let instant=wall;
  const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){
    const parts=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
    const actual=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
    instant+=wall-actual;
  }
  return new Date(instant).toISOString();
}

export function intelligenceSession(now:Date) {
  const date=easternDate(now);
  const next=new Date(Date.parse(`${date}T12:00:00Z`)+86_400_000).toISOString().slice(0,10);
  return {date,timeZone:'America/New_York' as const,startAt:midnight(date),endAt:midnight(next)};
}

/** A recent failed or unfinished run does not establish current SEC coverage. */
export function secCollectorIsFresh(lastRun:unknown,result:unknown,now:Date):boolean {
  const seen=observation(lastRun);
  if(!seen?.at||Date.parse(seen.at)>now.getTime()||now.getTime()-Date.parse(seen.at)>2*3_600_000)return false;
  if(!result||typeof result!=='object')return false;
  const run=result as Record<string,unknown>;
  return run.failed===0&&run.partial===0&&run.remaining===0&&run.outboxIncomplete===false;
}

export function canonicalEvidenceUrl(raw:string):string|null {
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password)return null;
    url.hash='';
    for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','gclid'].includes(key))url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString();
  }catch{return null;}
}

export function sourceChannel(raw:string):IntelligenceSource {
  try{
    const host=new URL(raw).hostname.toLowerCase();
    const domain=(name:string)=>host===name||host.endsWith(`.${name}`);
    if(domain('sec.gov'))return 'SEC';
    if(['cninfo.com.cn','sse.com.cn','szse.cn','hkexnews.hk'].some(domain))return 'Exchange';
    if(domain('github.com'))return 'GitHub';
    if(domain('x.com')||domain('twitter.com'))return 'X';
    if(domain('reddit.com'))return 'Reddit';
    if(/^(?:ir|investor|investors|investorrelations|investor-relations)\./.test(host))return 'IR';
  }catch{/* Invalid evidence is rejected before classification. */}
  return 'Other';
}

/** The same source document shared by several relationships counts once. */
export function summarizeIntelligence(events:IntelligenceEvent[],companyIds:string[],channel:IntelligenceSource|'',cutoff?:number) {
  const scope=new Set(companyIds);
  const visible=events.filter(event=>event.companyIds.some(id=>scope.has(id))&&(!channel||event.evidence.some(source=>source.channel===channel))&&(cutoff===undefined||Boolean(event.published_at&&Date.parse(event.published_at)<=cutoff)));
  const evidence=new Map<string,IntelligenceEvidence>();
  for(const event of visible)for(const source of event.evidence)if(!channel||source.channel===channel)evidence.set(source.url,source);
  const active=new Set(visible.flatMap(event=>event.companyIds).filter(id=>scope.has(id)));
  const sources=INTELLIGENCE_SOURCES.map(name=>({name,count:[...evidence.values()].filter(source=>source.channel===name).length}));
  return {events:visible,activeIds:[...active],signals:evidence.size,sources};
}

/** Compact, deduplicated source facts retain company associations for arbitrary UI filters. */
export function sourceDocumentsForEvents(events:IntelligenceEvent[]):IntelligenceSourceDocument[]{
  const documents=new Map<string,IntelligenceSourceDocument>();
  for(const event of events)for(const source of event.evidence){
    const id=canonicalEvidenceUrl(source.url);if(!id)continue;
    const existing=documents.get(id);
    if(existing)existing.companyIds=[...new Set([...existing.companyIds,...event.companyIds])];
    else documents.set(id,{id,channel:source.channel,companyIds:[...new Set(event.companyIds)],published_at:event.published_at,publication_date:event.publication_date});
  }
  return [...documents.values()];
}

export function summarizeSourceDocuments(documents:IntelligenceSourceDocument[],companyIds:string[],channel:IntelligenceSource|'',cutoff?:number){
  const scope=new Set(companyIds);
  const visible=documents.filter(document=>document.companyIds.some(id=>scope.has(id))&&(!channel||document.channel===channel)&&(cutoff===undefined||Boolean(document.published_at&&Date.parse(document.published_at)<=cutoff)));
  return {documents:visible,activeIds:[...new Set(visible.flatMap(document=>document.companyIds).filter(id=>scope.has(id)))],signals:visible.length,sources:INTELLIGENCE_SOURCES.map(name=>({name,count:visible.filter(document=>document.channel===name).length}))};
}
