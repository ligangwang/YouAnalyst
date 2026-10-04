import {createHash} from 'node:crypto';
import {observation} from '../model';
import {approvedNewsUrl,plainText,type NewsPage} from './news';
import type {NewsSource} from './sources';

export function englishPublicationDay(raw:string):string|null{
  const match=plainText(raw).match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),\s+(\d{4})$/i);
  if(!match)return null;
  const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].slice(0,3).toLowerCase())+1;
  return observation(`${match[3]}-${String(month).padStart(2,'0')}-${match[2].padStart(2,'0')}`)?.day??null;
}

/** Publisher-configured article paths only; navigation links cannot become news. */
export function parseHtmlNewsIndex(html:string,source:NewsSource):NewsPage{
  if(!source.articlePathPattern)throw new Error('HTML source has no approved article paths');
  const pattern=new RegExp(source.articlePathPattern),items=new Map<string,NewsPage['items'][number]>();
  for(const anchor of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    let href:string;try{href=new URL(plainText(anchor[1],2048),source.url).href;}catch{continue;}
    const url=approvedNewsUrl(href,source,true);
    if(!url||!pattern.test(new URL(url).pathname))continue;
    const title=plainText(anchor[2],240),id=createHash('sha256').update(url).digest('hex');
    items.set(id,{id,sourceId:source.id,companyId:source.companyId,url,title:title.length>=15?title:'',summary:'',published_at:null,publication_date:null});
  }
  if(!items.size)throw new Error('No readable publisher articles; source requires review');
  if(source.indexDateFormat==='alibaba'){
    const serialized=html.match(/window\.__ICE_PAGE_PROPS__=(\{[\s\S]*?\});/)?.[1];
    if(!serialized)throw new Error('Alibaba original listing metadata missing');
    const listing=JSON.parse(serialized) as {newsData?:{documentId:string;documentTitle:string;documentPublishTimeLocal:string}[]};
    if(!Array.isArray(listing.newsData))throw new Error('Alibaba listing format changed');
    for(const row of listing.newsData){
      if(!/^\d+$/.test(row.documentId))continue;
      const url=new URL(`/en-US/document-${row.documentId}`,source.url).href,id=createHash('sha256').update(url).digest('hex'),item=items.get(id);
      if(item){item.publication_date=englishPublicationDay(row.documentPublishTimeLocal);item.title=plainText(row.documentTitle,240);}
    }
  }
  if(source.indexDateFormat==='vistra'){
    for(const match of html.matchAll(/<div[^>]*class=["'][^"']*\bwd_date\b[^"']*["'][^>]*>([^<]+)<\/div>[\s\S]*?<a[^>]*href=["']([^"']+)["']/gi)){
      const url=approvedNewsUrl(new URL(plainText(match[2],2048),source.url).href,source,true);
      if(!url)continue;
      const item=items.get(createHash('sha256').update(url).digest('hex')),day=englishPublicationDay(match[1]);
      if(item&&day&&new URL(url).pathname.startsWith(`/${day}-`))item.publication_date=day;
    }
  }
  return {items:[...items.values()].slice(0,30),invalid:0,truncated:items.size>30};
}
/** Uses original publication metadata, never dateModified, feed updated or HTTP dates. */
export function originalArticleMetadata(html:string,visibleDate?:'linde'):{title:string;at:string|null;day:string|null}{
  const dates:string[]=[],titles:string[]=[];
  const visit=(value:unknown)=>{
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=='object')return;
    const row=value as Record<string,unknown>;
    const types=Array.isArray(row['@type'])?row['@type']:[row['@type']];
    if(types.some(type=>typeof type==='string'&&/^(?:NewsArticle|Article|BlogPosting)$/.test(type))){
      if(typeof row.datePublished==='string')dates.push(row.datePublished);
      if(typeof row.headline==='string')titles.push(row.headline);
    }
    if(row['@graph'])visit(row['@graph']);
  };
  for(const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(script[1]));}catch{}
  for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){
    const key=tag[0].match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1],value=tag[0].match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if(key==='article:published_time'&&value)dates.push(value);
    if(key==='og:title'&&value)titles.push(value);
  }
  const parsed=dates.map(d=>observation(d)).filter((date):date is NonNullable<typeof date>=>Boolean(date));
  if(visibleDate==='linde'){
    const text=html.match(/<time\b[^>]*class=["']time["'][^>]*>([^<]+)<\/time>/i)?.[1];
    return {title:plainText(titles[0]??'',240),at:null,day:text?englishPublicationDay(text):null};
  }
  const days=[...new Set(parsed.map(d=>d.at?d.at.slice(0,10):d.day))];
  if(days.length!==1)return {title:plainText(titles[0]??'',240),at:null,day:null};
  return {title:plainText(titles[0]??'',240),at:parsed.find(d=>d.at)?.at??null,day:days[0]};
}
