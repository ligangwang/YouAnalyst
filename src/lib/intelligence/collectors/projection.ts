import type {Firestore} from 'firebase-admin/firestore';
import type {KnowledgeGraph} from '../../knowledge-graph/model';
import {canonicalEvidenceUrl,easternDate,type IntelligenceEvent} from '../model';
import {NEWS_SOURCES} from './sources';
import {NEWS_COLLECTORS_COLLECTION,NEWS_EVENTS_COLLECTION} from './store';

export function projectCollectedNews(records:Record<string,unknown>[],graph:KnowledgeGraph,now:Date):IntelligenceEvent[]{
  const companies=new Set(graph.nodes.filter(node=>node.kind==='COMPANY').map(node=>node.id));
  return records.flatMap(record=>{
    const source=NEWS_SOURCES.find(source=>source.id===record.sourceId);
    if(!source||record.version!==1||record.baseline!==false||record.companyId!==source.companyId||!companies.has(source.companyId))return [];
    const url=typeof record.url==='string'?canonicalEvidenceUrl(record.url):null;
    const observed=typeof record.firstObservedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(record.firstObservedAt)?Date.parse(record.firstObservedAt):NaN;
    if(!url||!source.allowedHosts.includes(new URL(url).hostname)||!Number.isFinite(observed)||observed>now.getTime()||typeof record.title!=='string'||!record.title||typeof record.id!=='string')return [];
    const observedAt=new Date(observed).toISOString();
    return [{id:`news-${record.id}`,origin:source.companyId,companyIds:[source.companyId],edgeIds:[],category:'BUSINESS',title:record.title,summary:typeof record.summary==='string'&&record.summary?record.summary:'Official company news. Open the source for details.',observedAt,observedDate:easternDate(new Date(observed)),eventDate:typeof record.publishedDate==='string'?record.publishedDate:null,evidence:[{id:record.id,url,title:record.title,sourceDate:typeof record.publishedDate==='string'?record.publishedDate:null,channel:'IR'}],planned:false} satisfies IntelligenceEvent];
  });
}
export async function loadCollectedNews(db:Firestore,graph:KnowledgeGraph,now:Date,earliestDay:string,limit:number){
  const [page,states]=await Promise.all([
    db.collection(NEWS_EVENTS_COLLECTION).where('baseline','==',false).where('firstObservedAt','>=',`${earliestDay}T00:00:00.000Z`).orderBy('firstObservedAt','desc').limit(limit+1).get(),
    db.getAll(...NEWS_SOURCES.map(source=>db.collection(NEWS_COLLECTORS_COLLECTION).doc(source.id))),
  ]);
  const unhealthy=NEWS_SOURCES.filter((source,index)=>{
    const state=states[index].data();const success=typeof state?.lastSuccessAt==='string'?Date.parse(state.lastSuccessAt):NaN;
    return !Number.isFinite(success)||success>now.getTime()||now.getTime()-success>source.pollMs*3||state?.failures!==0||state?.partial!==false;
  });
  return {events:projectCollectedNews(page.docs.slice(0,limit).map(doc=>doc.data()),graph,now),truncated:page.size>limit,fresh:unhealthy.length===0,unhealthy:unhealthy.map(source=>source.name)};
}
