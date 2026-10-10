import { canonicalEvidenceUrl, observation, type IntelligenceEvent } from './model';

const normalize = (text:string) => text.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const defaultSummary = normalize('Official company news. Open the source for details.');
const details = (event:IntelligenceEvent) => normalize(event.summary) === defaultSummary ? '' : normalize(event.summary);

function announcementKey(event:IntelligenceEvent):string|null {
  // Only verified company-news projections qualify, never filings or research.
  if(!event.id.startsWith('news-company_news_')||event.category!=='BUSINESS'||event.companyIds.length!==1||event.companyIds[0]!==event.origin||!event.evidence.length||event.evidence.some(source=>source.channel!=='IR'))return null;
  const title=normalize(event.title);
  // Exact, substantive original headlines only; translations are not identities.
  if(title.length<40||(title.match(/[\p{L}\p{N}]+/gu)?.length??0)<6||/\b(?:company|business|corporate|general|news) updates?\b|\b(?:press|news) release\b/.test(title))return null;
  const dates=new Set(event.evidence.map(source=>source.sourceDate));
  if(dates.size!==1)return null;
  const day=[...dates][0];
  if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!observation(day))return null;
  return JSON.stringify([event.origin,title,day,event.planned]);
}

function compatible(a:IntelligenceEvent,b:IntelligenceEvent):boolean {
  if(a.eventDate&&b.eventDate&&a.eventDate!==b.eventDate)return false;
  if(details(a)&&details(b)&&details(a)!==details(b))return false;
  if(a.calendarEvents?.length&&b.calendarEvents?.length){
    const days=(event:IntelligenceEvent)=>JSON.stringify([...new Set(event.calendarEvents!.map(link=>`${link.companyId}:${link.day}`))].sort());
    if(days(a)!==days(b))return false;
  }
  return !a.published_at||!b.published_at||Math.abs(Date.parse(a.published_at)-Date.parse(b.published_at))<=36*3_600_000;
}

function merge(a:IntelligenceEvent,b:IntelligenceEvent):IntelligenceEvent {
  const day=a.evidence[0].sourceDate!;
  // Prefer a timestamp consistent with the publisher day over midnight aliases.
  const quality=(event:IntelligenceEvent)=>event.publication_date!==day?0:event.published_at?2:1;
  const preferred=quality(b)>quality(a)||(quality(b)===quality(a)&&(b.published_at??'')>(a.published_at??''))?b:a;
  const other=preferred===a?b:a;
  const ids=[...new Set([a.id,b.id,...(a.relatedEventIds??[]),...(b.relatedEventIds??[])])].sort();
  return {...preferred,id:ids[0],relatedEventIds:ids.slice(1),
    titleEn:preferred.titleEn||other.titleEn,titleZh:preferred.titleZh||other.titleZh,
    summary:details(preferred)?preferred.summary:other.summary,
    eventDate:preferred.eventDate??other.eventDate,
    edgeIds:[...new Set([...a.edgeIds,...b.edgeIds])],
    evidence:[...new Map([...preferred.evidence,...other.evidence].map(source=>[canonicalEvidenceUrl(source.url)??source.url,source])).values()],
    calendarEvents:a.calendarEvents||b.calendarEvents?[...new Map([...(a.calendarEvents??[]),...(b.calendarEvents??[])].map(link=>[link.id,link])).values()]:undefined,
  };
}

/** One announcement can retain several independently counted reference documents. */
export function groupCompanyAnnouncements(events:IntelligenceEvent[]):IntelligenceEvent[] {
  const result:IntelligenceEvent[]=[];
  const groups=new Map<string,number[]>();
  for(const event of events){
    const key=announcementKey(event),candidates=key?groups.get(key)??[]:[];
    const index=candidates.find(index=>compatible(result[index],event));
    if(index!==undefined)result[index]=merge(result[index],event);
    else {if(key)groups.set(key,[...candidates,result.length]);result.push(event);}
  }
  return result;
}
