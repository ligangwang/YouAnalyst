import {createHash} from 'node:crypto';
import type {KnowledgeGraph} from '../knowledge-graph/model';
import type {StoredEvent} from './model';
import {eventDocumentId} from './model';
import {sourcePublication} from '../sec-filings/event';
import {plainText} from '../intelligence/collectors/news';
import {secFilingCategory,secFilingLink,SEC_FILING_DESCRIPTIONS,type SecFilingCategory} from './sec-filing-metadata';

export type Disclosure = Omit<StoredEvent,'collected_at'|'processed_at'|'baseline'> & {
  companyId:string; sourceType:'sec'|'exchange'; form?:string; accession?:string;
  category:'EARNINGS'|'FILING'; filingCategory?:SecFilingCategory;
};
export function mapListedCompanies(graph:Pick<KnowledgeGraph,'nodes'>){
  return graph.nodes.filter(n=>n.kind==='COMPANY'&&(
    n.market==='US'&&/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(n.id)||
    n.market==='CN_A'&&/^(?:XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(n.id)
  )).sort((a,b)=>a.id.localeCompare(b.id));
}
const hash=(key:string)=>createHash('sha256').update(key).digest('hex');
const validDay=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

/** All forms associated with the issuer in SEC submissions, including third-party ownership filings. */
export function secDisclosureRows(companyId:string,cik:string,payload:unknown):Disclosure[]{
  if(!/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(companyId)||!/^\d{10}$/.test(cik)||Number(cik)===0)throw new Error('Invalid SEC map identity');
  const raw=payload as {cik?:unknown;filings?:{recent?:Record<string,unknown>}};
  if(Number(raw?.cik)!==Number(cik))throw new Error('SEC disclosure issuer mismatch');
  const rows=raw.filings?.recent;
  const keys=['accessionNumber','form','filingDate','primaryDocument'] as const;
  if(!rows||keys.some(k=>!Array.isArray(rows[k]))||keys.some(k=>(rows[k] as unknown[]).length!==(rows.form as unknown[]).length))throw new Error('Incomplete SEC disclosure columns');
  for(const key of ['items','acceptanceDateTime'])if(rows[key]!==undefined&&(!Array.isArray(rows[key])||(rows[key] as unknown[]).length!==(rows.form as unknown[]).length))throw new Error('Incomplete SEC optional columns');
  const output=new Map<string,Disclosure>();
  for(let i=0;i<(rows.form as unknown[]).length;i++){
    const form=(rows.form as unknown[])[i];
    if(typeof form!=='string'||!/^[A-Z0-9][A-Z0-9 /()._-]{0,79}$/.test(form)||form.trim()!==form)throw new Error('Invalid SEC disclosure form');
    const accession=(rows.accessionNumber as unknown[])[i],day=(rows.filingDate as unknown[])[i],document=(rows.primaryDocument as unknown[])[i];
    if(typeof accession!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||!validDay(day)||typeof document!=='string')throw new Error('Invalid SEC disclosure row');
    const items=Array.isArray(rows.items)?rows.items[i]:null;
    const category=form.startsWith('8-K')&&typeof items==='string'&&items.split(',').map(s=>s.trim()).includes('2.02')?'EARNINGS':'FILING';
    const url=secFilingLink(cik,accession,document),filingCategory=secFilingCategory(form);
    const title=`${companyId.slice(3)} · ${category==='EARNINGS'?'Earnings announcement':`${form} filing`}`;
    const row:Disclosure={version:1,id:eventDocumentId('company_disclosure',hash(`${companyId}|sec|${accession}`)),type:'company_disclosure',sourceType:'sec',sourceId:`sec-${companyId}`,companyId,companyIds:[companyId],title,summary:category==='EARNINGS'?'Results of operations announcement (SEC Item 2.02). Open the filing and its earnings release exhibits.':`${form}: ${SEC_FILING_DESCRIPTIONS[filingCategory]}`,url,published_at:sourcePublication(Array.isArray(rows.acceptanceDateTime)?rows.acceptanceDateTime[i]:null),publication_date:day,category,form,accession,filingCategory};
    const previous=output.get(row.id);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw new Error('Conflicting SEC disclosure accession');
    output.set(row.id,row);
  }
  return [...output.values()];
}

export function cnDisclosureRows(companyId:string,orgId:string,payload:unknown):Disclosure[]{
  if(!/^(?:XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId)||!orgId)throw new Error('Invalid exchange identity');
  const page=payload as {announcements?:unknown;hasMore?:unknown;totalAnnouncement?:unknown};
  if(page?.announcements===null&&page.hasMore===false&&page.totalAnnouncement===0)return [];
  if(!Array.isArray(page?.announcements)||typeof page.hasMore!=='boolean'||!Number.isSafeInteger(page.totalAnnouncement)||Number(page.totalAnnouncement)<0)throw new Error('Incomplete exchange disclosure page');
  return page.announcements.map((value:unknown)=>{
    const row=value as Record<string,unknown>;
    if(row?.secCode!==companyId.split(':')[1]||row.orgId!==undefined&&row.orgId!==orgId)throw new Error('Exchange disclosure issuer mismatch');
    const title=plainText(row.announcementTitle,240),path=row.adjunctUrl;
    if(!title||!/^\d+$/.test(String(row.announcementId))||typeof path!=='string'||!/^finalpage\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.pdf$/i.test(path)||!validDay(path.split('/')[1]))throw new Error('Invalid exchange disclosure document');
    const day=path.split('/')[1];
    if(typeof row.announcementTime==='number'&&new Date(row.announcementTime+8*3600000).toISOString().slice(0,10)!==day)throw new Error('Conflicting exchange publication dates');
    const category=/业绩|(?:季度|半年度|年度)报告/.test(title)?'EARNINGS':'FILING';
    return {version:1,id:eventDocumentId('company_disclosure',hash(`${companyId}|cninfo|${row.announcementId}`)),type:'company_disclosure',sourceType:'exchange',sourceId:`exchange-${companyId}`,companyId,companyIds:[companyId],title,summary:'交易所上市公司原始公告。',url:`https://static.cninfo.com.cn/${path}`,published_at:null,publication_date:day,category} satisfies Disclosure;
  });
}
