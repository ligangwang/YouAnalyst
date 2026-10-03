import type {Firestore} from 'firebase-admin/firestore';
import type {KnowledgeGraph} from '../../knowledge-graph/model';
import {canonicalEvidenceUrl,observation,type IntelligenceEvent} from '../model';
import {NEWS_SOURCES} from './sources';
import {NEWS_COLLECTORS_COLLECTION,NEWS_EVENTS_COLLECTION} from './store';

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
export async function loadCollectedNews(db:Firestore,graph:KnowledgeGraph,now:Date,earliestDay:string,limit:number){
  const typed=()=>db.collection(NEWS_EVENTS_COLLECTION).where('type','==','company_news').where('sourceType','==','company_ir');
  const [page,dated,states]=await Promise.all([
    typed().where('published_at','>=',`${earliestDay}T00:00:00.000Z`).orderBy('published_at','desc').limit(limit+1).get(),
    typed().where('published_at','==',null).where('publication_date','>=',earliestDay).orderBy('publication_date','desc').limit(limit+1).get(),
    db.getAll(...NEWS_SOURCES.map(source=>db.collection(NEWS_COLLECTORS_COLLECTION).doc(source.id))),
  ]);
  const unhealthy=NEWS_SOURCES.filter((source,index)=>{
    const state=states[index].data();const success=typeof state?.lastSuccessAt==='string'?Date.parse(state.lastSuccessAt):NaN;
    return !Number.isFinite(success)||success>now.getTime()||now.getTime()-success>source.pollMs*3||state?.failures!==0||state?.partial!==false;
  });
  const events=[...new Map(projectCollectedNews([...page.docs,...dated.docs].map(doc=>doc.data()),graph,now).map(event=>[event.id,event])).values()].sort((a,b)=>(b.published_at??b.publication_date).localeCompare(a.published_at??a.publication_date));
  return {events:events.slice(0,limit),truncated:page.size>limit||dated.size>limit||events.length>limit,fresh:unhealthy.length===0,unhealthy:unhealthy.map(source=>source.name)};
}
