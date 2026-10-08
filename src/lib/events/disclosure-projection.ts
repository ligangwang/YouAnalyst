import {translatedSummary} from '../knowledge-graph/summary-translations';
import {readPeriodDocuments} from '../intelligence/period-query';
import type {Firestore} from 'firebase-admin/firestore';
import type {KnowledgeGraph} from '../knowledge-graph/model';
import {canonicalEvidenceUrl,observation,type IntelligenceEvent} from '../intelligence/model';
import {EVENTS_COLLECTION} from './model';
import {mapListedCompanies} from './disclosures';
import {safeSecDocumentPath} from './sec-filing-metadata';

export function projectDisclosures(records:Record<string,unknown>[],graph:KnowledgeGraph,now:Date):IntelligenceEvent[]{
  const ids=new Set(mapListedCompanies(graph).map(n=>n.id));
  return records.flatMap(row=>{
    if(row.version!==1||row.type!=='company_disclosure'||typeof row.companyId!=='string'||!ids.has(row.companyId)||typeof row.id!=='string'||typeof row.title!=='string'||!Array.isArray(row.companyIds)||!row.companyIds.includes(row.companyId))return [];
    const url=typeof row.url==='string'?canonicalEvidenceUrl(row.url):null,date=observation(row.published_at??row.publication_date);
    if(!url||!date||date.at&&Date.parse(date.at)>now.getTime())return [];
    const parsed=new URL(url),secPath=parsed.pathname.match(/^\/Archives\/edgar\/data\/\d+\/\d{18}\/(.+)$/);
    const sec=row.sourceType==='sec'&&row.companyId.startsWith('US:')&&parsed.hostname==='www.sec.gov'&&Boolean(secPath&&safeSecDocumentPath(secPath[1]));
    const exchange=row.sourceType==='exchange'&&/^(?:XSHG|XSHE):/.test(row.companyId)&&parsed.hostname==='static.cninfo.com.cn'&&/^\/finalpage\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.pdf$/i.test(parsed.pathname);
    if(!sec&&!exchange)return [];
    return [{id:`disclosure-${row.id}`,origin:row.companyId,companyIds:[row.companyId],edgeIds:[],category:row.category==='EARNINGS'?'BUSINESS':'FILING',title:row.title,titleEn:translatedSummary(row.title,(row.titleTranslations as Record<string,unknown>|undefined)?.en),titleZh:translatedSummary(row.title,(row.titleTranslations as Record<string,unknown>|undefined)?.["zh-CN"]),summary:typeof row.summary==='string'?row.summary:'Official company disclosure.',published_at:date.at,publication_date:date.day,eventDate:typeof row.publication_date==='string'?row.publication_date:null,evidence:[{id:row.id,url,title:row.title,sourceDate:typeof row.publication_date==='string'?row.publication_date:null,channel:sec?'SEC':'Exchange'}],planned:false} satisfies IntelligenceEvent];
  });
}
export async function loadMapDisclosures(db:Firestore,graph:KnowledgeGraph,now:Date,from:string,limit?:number){
  const query=()=>db.collection(EVENTS_COLLECTION).where('type','==','company_disclosure');
  const read=(value:ReturnType<typeof query>)=>limit===undefined?readPeriodDocuments(value):value.limit(limit+1).get().then(page=>page.docs);
  const [exact,dated]=await Promise.all([
    read(query().where('published_at','>=',`${from}T00:00:00.000Z`).orderBy('published_at','desc')),
    read(query().where('published_at','==',null).where('publication_date','>=',from).orderBy('publication_date','desc')),
  ]);
  const events=projectDisclosures([...exact,...dated].map(d=>d.data()),graph,now);
  events.sort((a,b)=>(b.published_at??b.publication_date).localeCompare(a.published_at??a.publication_date));
  return {events:limit===undefined?events:events.slice(0,limit),truncated:limit!==undefined&&(exact.length>limit||dated.length>limit||events.length>limit)};
}
