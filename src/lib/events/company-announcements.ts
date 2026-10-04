import {getAdminFirestore} from '../firebase/admin';
import {NEWS_SOURCES} from '../intelligence/collectors/sources';
import {canonicalEvidenceUrl,observation} from '../intelligence/model';
import {EVENTS_COLLECTION} from './model';

export type CompanyAnnouncement={id:string;title:string;url:string;date:string;channel:'IR'|'SEC'|'Exchange';earnings:boolean;form?:string};
export function publicCompanyAnnouncement(row:Record<string,unknown>,companyId:string):CompanyAnnouncement|null{
  const url=typeof row.url==='string'?canonicalEvidenceUrl(row.url):null,date=observation(row.published_at??row.publication_date);
  if(row.version!==1||row.companyId!==companyId||typeof row.id!=='string'||typeof row.title!=='string'||!url||!date)return null;
  const parsed=new URL(url),host=parsed.hostname;
  const ir=row.type==='company_news'&&row.sourceType==='company_ir'&&NEWS_SOURCES.some(s=>s.id===row.sourceId&&s.companyId===companyId&&s.allowedHosts.includes(host));
  const sec=row.type==='company_disclosure'&&row.sourceType==='sec'&&companyId.startsWith('US:')&&host==='www.sec.gov'&&/^\/Archives\/edgar\/data\/\d+\/\d{18}\/[\w.-]+$/.test(parsed.pathname);
  const exchange=row.type==='company_disclosure'&&row.sourceType==='exchange'&&/^(?:XSHE|XSHG):/.test(companyId)&&host==='static.cninfo.com.cn'&&/^\/finalpage\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.pdf$/i.test(parsed.pathname);
  if(!ir&&!sec&&!exchange)return null;
  const earnings=row.category==='EARNINGS'||ir&&/\b(?:reports?|announces?)\b.*\b(?:quarter|year|financial).*\bresults\b/i.test(row.title)&&!/\b(?:to report|date of|will report)\b/i.test(row.title);
  return {id:row.id,title:row.title,url,date:date.day,channel:ir?'IR':sec?'SEC':'Exchange',earnings,...(sec&&typeof row.form==='string'?{form:row.form}:{})};
}
export async function loadCompanyAnnouncements(companyId:string){
  if(!/^(?:US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId))return [];
  try{
    const page=await getAdminFirestore().collection(EVENTS_COLLECTION).where('companyId','==',companyId).orderBy('publication_date','desc').limit(30).get();
    const today=new Date().toISOString().slice(0,10);
    return page.docs.map(doc=>publicCompanyAnnouncement(doc.data(),companyId)).filter((row):row is CompanyAnnouncement=>Boolean(row&&row.date<=today)).slice(0,12);
  }catch(error){console.error('Company announcement sources unavailable',companyId,error);return [];}
}
