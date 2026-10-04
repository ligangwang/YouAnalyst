import {readPeriodDocuments} from '../period-query';
import type {Firestore} from 'firebase-admin/firestore';
import type {KnowledgeGraph} from '../../knowledge-graph/model';
import {canonicalEvidenceUrl,observation,type IntelligenceEvent} from '../model';
import {NEWS_SOURCES} from './sources';
import {NEWS_COLLECTORS_COLLECTION,NEWS_EVENTS_COLLECTION} from './store';

/** Weekend pauses are expected; compare against the latest weekday poll slot. */
export function newsCollectorIsFresh(lastSuccess:unknown,failures:unknown,partial:unknown,now:Date,pollMs:number){
  const success=typeof lastSuccess==='string'?Date.parse(lastSuccess):NaN;
  let slot=Math.floor(now.getTime()/pollMs)*pollMs;
  const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short'});
  for(let hours=0;hours<72;hours++){
    if(!['Sat','Sun'].includes(weekday.format(new Date(slot))))break;
    slot-=pollMs;
  }
  return Number.isFinite(success)&&success<=now.getTime()&&success>=slot-2*pollMs&&failures===0&&partial===false;
}

/** Explicit public projection: ingestion and processing timestamps never leave this boundary. */
export function projectCollectedNews(records:Record<string,unknown>[],graph:KnowledgeGraph,now:Date):IntelligenceEvent[]{
  const companies=new Set(graph.nodes.filter(node=>node.kind==='COMPANY').map(node=>node.id));
  return records.flatMap(record=>{
    const source=NEWS_SOURCES.find(source=>source.id===record.sourceId);
    if(!source||record.version!==1||record.type!=='company_news'||record.sourceType!=='company_ir'||record.companyId!==source.companyId||!Array.isArray(record.companyIds)||!record.companyIds.includes(source.companyId)||!companies.has(source.companyId))return [];
    const url=typeof record.url==='string'?canonicalEvidenceUrl(record.url):null;
    const publication=observation(record.published_at??record.publication_date);
    if(!url||!source.allowedHosts.includes(new URL(url).hostname)||!publication||(publication.at&&Date.parse(publication.at)>now.getTime())||typeof record.title!=='string'||!record.title||typeof record.id!=='string')return [];
    return [{id:`news-${record.id}`,origin:source.companyId,companyIds:[source.companyId],edgeIds:[],category:'BUSINESS',title:record.title,summary:typeof record.summary==='string'&&record.summary?record.summary:'Official company news. Open the source for details.',published_at:publication.at,publication_date:publication.day,eventDate:typeof record.publication_date==='string'?record.publication_date:null,evidence:[{id:record.id,url,title:record.title,sourceDate:typeof record.publication_date==='string'?record.publication_date:null,channel:'IR'}],planned:false} satisfies IntelligenceEvent];
  });
}
export async function loadCollectedNews(db:Firestore,graph:KnowledgeGraph,now:Date,earliestDay:string,limit?:number){
  const typed=()=>db.collection(NEWS_EVENTS_COLLECTION).where('type','==','company_news').where('sourceType','==','company_ir');
  const read=(query:ReturnType<typeof typed>)=>limit===undefined?readPeriodDocuments(query):query.limit(limit+1).get().then(page=>page.docs);
  const [page,dated,states]=await Promise.all([
    read(typed().where('published_at','>=',`${earliestDay}T00:00:00.000Z`).orderBy('published_at','desc')),
    read(typed().where('published_at','==',null).where('publication_date','>=',earliestDay).orderBy('publication_date','desc')),
    db.getAll(...NEWS_SOURCES.map(source=>db.collection(NEWS_COLLECTORS_COLLECTION).doc(source.id))),
  ]);
  const unhealthy=NEWS_SOURCES.filter((source,index)=>{
    const state=states[index].data();
    return !newsCollectorIsFresh(state?.lastSuccessAt,state?.failures,state?.partial,now,source.pollMs);
  });
  const events=[...new Map(projectCollectedNews([...page,...dated].map(doc=>doc.data()),graph,now).map(event=>[event.id,event])).values()].sort((a,b)=>(b.published_at??b.publication_date).localeCompare(a.published_at??a.publication_date));
  return {events:limit===undefined?events:events.slice(0,limit),truncated:limit!==undefined&&(page.length>limit||dated.length>limit||events.length>limit),fresh:unhealthy.length===0,unhealthy:unhealthy.map(source=>source.name),healthyCompanyIds:NEWS_SOURCES.filter(source=>!unhealthy.includes(source)).map(source=>source.companyId)};
}
