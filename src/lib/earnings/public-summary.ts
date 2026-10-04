import {canonicalEvidenceUrl} from '../intelligence/model';
import {validDate,validatePeriod,type EarningsRecord,type EarningsMetric} from './model';

export type PublicEarningsSummary={
  companyId:string;title:string;url:string;publishedDate:string|null;
  period:{start:string;end:string;type:EarningsRecord['period']['type'];fiscalYear:number;fiscalQuarter?:number};
  metrics:{name:EarningsMetric["name"];value:number;unit:string;basis:EarningsMetric["basis"]}[];
};

/** Display only actual consolidated results from a complete, sourced extraction. */
export function publicEarningsSummary(record:EarningsRecord,companyId:string,now=new Date()):PublicEarningsSummary|null{
  if(!record||record.version!==1||record.type!=='earnings.extracted'||record.companyId!==companyId||record.source?.companyId!==companyId||record.kind!=='actual'||record.completeness!=='full')return null;
  try{validatePeriod(record.period);}catch{return null;}
  if(record.period.end>now.toISOString().slice(0,10))return null;
  const url=canonicalEvidenceUrl(record.source.url);if(!url)return null;
  const parsed=new URL(url),cik=record.issuerId?.match(/^sec:(\d{10})$/)?.[1];
  if(record.source.provider==='sec'){
    const issuer=parsed.pathname.match(/^\/Archives\/edgar\/data\/(\d+)\/\d{18}\/[\w.-]+$/)?.[1];
    if(parsed.hostname!=='www.sec.gov'||!cik||Number(issuer)!==Number(cik))return null;
  }else if(record.source.provider==='cninfo'){
    if(!['static.cninfo.com.cn','dataclouds.cninfo.com.cn','www.cninfo.com.cn'].includes(parsed.hostname))return null;
  }else return null; // Add IR metric display only with a verified publisher adapter.
  const metrics=(record.metrics??[]).filter(metric=>
    ['revenue','revenue_yoy','revenue_qoq'].includes(metric.name)&&metric.kind==='actual'&&metric.scope==='consolidated'
    &&metric.sourceEvidenceKind==='raw_document'&&metric.evidence?.length>0
    &&metric.period.start===record.period.start&&metric.period.end===record.period.end&&metric.period.type===record.period.type&&metric.period.fiscalYear===record.period.fiscalYear&&metric.period.fiscalQuarter===record.period.fiscalQuarter
    &&typeof metric.value==='number'&&Number.isFinite(metric.value)
    &&(metric.name==='revenue'?metric.unit==='currency'&&/^[A-Z]{3}$/.test(metric.currency??''):metric.unit==='percent'&&metric.currency===null)
    &&['US_GAAP','IFRS','PRC_GAAP','non_GAAP','unspecified'].includes(metric.basis)
    &&canonicalEvidenceUrl(metric.sourceUrl)===url
  );
  // Conflicting metrics or bases never acquire a made-up preferred value.
  const unique=metrics.filter(metric=>metrics.filter(other=>other.name===metric.name).length===1);
  if(!unique.some(metric=>metric.name==='revenue'))return null;
  const published=record.announcementDate??record.source.publishedAt?.value.slice(0,10)??null;
  if(published&&(!validDate(published)||published>now.toISOString().slice(0,10)))return null;
  return {companyId,title:record.source.title,url,publishedDate:published,period:{...record.period},metrics:unique.map(metric=>({name:metric.name,value:metric.value!,unit:metric.unit==='percent'?'%':metric.currency!,basis:metric.basis}))};
}

export function latestPublicEarnings(records:EarningsRecord[],heads:Map<string,string>,companyId:string,now=new Date()):PublicEarningsSummary|null{
  const current=records.filter(record=>record.companyId===companyId&&heads.get(record.eventId)===record.revisionId);
  const superseded=new Set(current.map(record=>record.supersedes).filter(Boolean));
  return current.filter(record=>!superseded.has(record.eventId)).map(record=>publicEarningsSummary(record,companyId,now)).filter((summary):summary is PublicEarningsSummary=>Boolean(summary)).sort((a,b)=>b.period.end.localeCompare(a.period.end)||(b.publishedDate??'').localeCompare(a.publishedDate??'')||Number(b.period.type==='quarter')-Number(a.period.type==='quarter'))[0]??null;
}
