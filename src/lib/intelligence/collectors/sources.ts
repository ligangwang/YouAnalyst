import assert from 'node:assert/strict';
import {isCollectionCompany,type ThemedCompany} from '../../company-themes/model';

export type NewsSource = {
  id:string; companyId:string; name:string; url:string; allowedHosts:string[]; articleHostAliases?:Record<string,string>; publicationFromArticle?:boolean; articleDateFormat?:'apple-newsroom'; pollMs:number;
  format?:'html'; articlePathPattern?:string; transport?:'https'; articleDateOnly?:boolean; upgradeArticleHttp?:boolean;
  indexDateFormat?:'alibaba'|'vistra'; articleVisibleDate?:'linde'; reviewRequired?:string;
  excludedCategories?:string[]; resolveRelativeArticleLinks?:boolean;
};

export type CompanyNewsSource=NewsSource & {status:'PUBLISHED'|'DRAFT'|'WITHDRAWN';reviewedAt:string};
const fields=['id','companyId','name','url','allowedHosts','articleHostAliases','publicationFromArticle','articleDateFormat','pollMs','format','articlePathPattern','transport','articleDateOnly','upgradeArticleHttp','indexDateFormat','articleVisibleDate','reviewRequired','excludedCategories','resolveRelativeArticleLinks','status','reviewedAt'];
const publicHost=(host:string)=>/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)&&!/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/i.test(host);

/** Only operator-reviewed, publisher-owned HTTPS adapters are executable. */
export function validateCompanyNewsSource(value:unknown,companyId:string):CompanyNewsSource{
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Invalid news source');
  const row=value as CompanyNewsSource;
  assert(Object.keys(row).every(key=>fields.includes(key)),'Unknown news adapter setting');
  assert(/^[a-z0-9][a-z0-9-]{1,79}$/.test(row.id)&&row.companyId===companyId&&typeof row.name==='string'&&row.name.trim(),'Invalid source identity');
  assert(['PUBLISHED','DRAFT','WITHDRAWN'].includes(row.status),'Invalid source status');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(row.reviewedAt)&&new Date(row.reviewedAt).toISOString().slice(0,10)===row.reviewedAt&&row.reviewedAt<=new Date().toISOString().slice(0,10),'Invalid source review date');
  assert(Array.isArray(row.allowedHosts)&&row.allowedHosts.length>0&&row.allowedHosts.length<=20&&row.allowedHosts.every(host=>typeof host==='string'&&publicHost(host)),'Invalid approved hosts');
  const url=new URL(row.url);
  assert(url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&row.allowedHosts.includes(url.hostname),'Unapproved feed URL');
  assert(Number.isInteger(row.pollMs)&&row.pollMs>=60_000&&row.pollMs<=86_400_000,'Invalid polling interval');
  for(const key of ['publicationFromArticle','articleDateOnly','upgradeArticleHttp','resolveRelativeArticleLinks'] as const)assert(row[key]===undefined||typeof row[key]==='boolean','Invalid adapter boolean');
  assert(row.format===undefined||row.format==='html','Unsupported feed format');
  assert(row.transport===undefined||row.transport==='https','Unsupported transport');
  assert(row.articleDateFormat===undefined||row.articleDateFormat==='apple-newsroom','Unsupported article date parser');
  assert(row.indexDateFormat===undefined||['alibaba','vistra'].includes(row.indexDateFormat),'Unsupported index date parser');
  assert(row.articleVisibleDate===undefined||row.articleVisibleDate==='linde','Unsupported visible date parser');
  if(row.articlePathPattern!==undefined){assert(typeof row.articlePathPattern==='string'&&row.articlePathPattern.length<=512,'Invalid article path parser');new RegExp(row.articlePathPattern);}
  if(row.excludedCategories!==undefined)assert(Array.isArray(row.excludedCategories)&&row.excludedCategories.every(item=>typeof item==='string'&&item.length<=100),'Invalid excluded categories');
  if(row.articleHostAliases!==undefined)assert(row.articleHostAliases&&typeof row.articleHostAliases==='object'&&!Array.isArray(row.articleHostAliases)&&Object.entries(row.articleHostAliases).every(([from,to])=>publicHost(from)&&row.allowedHosts.includes(to)),'Unapproved host alias');
  if(row.status==='PUBLISHED')assert(!row.reviewRequired,'Source still requires review');
  return structuredClone(row);
}

export function approvedCompanyNewsSources(records:ThemedCompany[]):NewsSource[]{
  const sources:NewsSource[]=[],ids=new Set<string>();
  for(const company of records.filter(isCollectionCompany)){
    if(company.newsSources===undefined)continue;
    assert(Array.isArray(company.newsSources),`${company.id}: invalid newsSources`);
    for(const raw of company.newsSources){
      if(raw?.status!=='PUBLISHED')continue;
      const row=validateCompanyNewsSource(raw,company.id);
      assert(!ids.has(row.id),`Duplicate source ID: ${row.id}`);ids.add(row.id);
      const {status:_,reviewedAt:__,...config}=row;void _;void __;sources.push(config);
    }
  }
  return sources;
}
