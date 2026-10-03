import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {canonicalEvidenceUrl,observation} from '../model';
import type {NewsSource} from './sources';

export const MAX_FEED_BYTES=2_000_000,MAX_FEED_ITEMS=100;
export type NewsItem={id:string;sourceId:string;companyId:string;title:string;summary:string;url:string;published_at:string|null;publication_date:string|null};
export type NewsPage={items:NewsItem[];invalid:number;truncated:boolean};
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:value?[value]:[];
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const string=(value:unknown):string=>typeof value==='string'?value:typeof value==='number'?String(value):typeof object(value)['#text']==='string'?String(object(value)['#text']):'';
export function plainText(value:unknown,max=320){
  return string(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,number:string)=>{const code=number[0].toLowerCase()==='x'?parseInt(number.slice(1),16):Number(number);return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'';}).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[entity]!)).replace(/\s+/g,' ').trim().slice(0,max);
}
export function approvedNewsUrl(raw:string,source:NewsSource,article=false):string|null{
  let canonical=canonicalEvidenceUrl(raw.replace(/&amp;/g,'&'));if(!canonical)return null;
  if(article){const url=new URL(canonical),alias=source.articleHostAliases?.[url.hostname];if(alias){url.hostname=alias;canonical=url.toString();}}
  return source.allowedHosts.includes(new URL(canonical).hostname)?canonical:null;
}
function publication(raw:unknown):{at:string|null;day:string|null}{
  const value=string(raw).trim(),parsed=observation(value);
  if(parsed){const at=parsed.at?new Date(parsed.at).toISOString():null;return {at,day:at?at.slice(0,10):parsed.day};}
  // RSS dates must specify their timezone; local machine time must never enter the feed.
  if(!/(?:\bGMT|\bUTC|[+-]\d{4})$/i.test(value))return {at:null,day:null};
  const time=Date.parse(value);if(!Number.isFinite(time))return {at:null,day:null};
  const at=new Date(time).toISOString();return {at,day:at.slice(0,10)};
}
export function parseNewsFeed(xml:string,source:NewsSource):NewsPage{
  if(Buffer.byteLength(xml)>MAX_FEED_BYTES)throw new Error('Feed exceeds size limit');
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw new Error('Feed entity declarations are unsupported');
  if(XMLValidator.validate(xml)!==true)throw new Error('Malformed XML feed');
  const parsed=object(new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:false}).parse(xml));
  const channel=object(object(parsed.rss).channel),feed=object(parsed.feed);
  if(!parsed.rss&&!parsed.feed)throw new Error('Expected RSS or Atom feed');
  if(parsed.rss&&!object(parsed.rss).channel)throw new Error('RSS channel is missing');
  const entries=array(parsed.rss?channel.item:feed.entry);
  const items=new Map<string,NewsItem>();let invalid=0;
  for(const entry of entries.slice(0,MAX_FEED_ITEMS)){
    const item=object(entry),link=array(item.link).filter(value=>typeof value==='string'||!object(value)['@_rel']||object(value)['@_rel']==='alternate').map(value=>typeof value==='string'?value:object(value)['@_href']).find(value=>typeof value==='string'&&value.startsWith('https:'));
    const url=typeof link==='string'?approvedNewsUrl(link,source,true):null,title=plainText(item.title,240);
    if(!url||!title){invalid++;continue;}
    const date=publication(item.pubDate??item.published);
    const id=createHash('sha256').update(url).digest('hex');
    items.set(id,{id,sourceId:source.id,companyId:source.companyId,url,title,summary:plainText(item.description??item.summary??item.content),published_at:date.at,publication_date:date.day});
  }
  return {items:[...items.values()],invalid,truncated:entries.length>MAX_FEED_ITEMS};
}

export type NewsValidators={etag?:string;lastModified?:string};
export type NewsResponse={status:'modified';page:NewsPage;validators:NewsValidators;collected_at?:string}|{status:'unchanged'};
export class NewsFetchError extends Error{
  constructor(message:string,readonly retryAfterMs:number){super(message);}
}
export async function fetchNews(source:NewsSource,validators:NewsValidators={},request:typeof fetch=fetch):Promise<NewsResponse>{
  let url=source.url;
  const signal=AbortSignal.timeout(20_000);
  const headers:Record<string,string>={'User-Agent':'YouAnalyst/1.0 (+https://youanalyst.com)','Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml'};
  if(validators.etag)headers['If-None-Match']=validators.etag;
  else if(validators.lastModified)headers['If-Modified-Since']=validators.lastModified;
  for(let redirects=0;redirects<=3;redirects++){
    if(!approvedNewsUrl(url,source))throw new Error('Unapproved feed host');
    const response=await request(url,{headers,redirect:'manual',signal});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');await response.body?.cancel();
      if(!location)throw new Error('Feed redirect has no location');
      url=new URL(location,url).toString();continue;
    }
    if(response.status===304){await response.body?.cancel();return {status:'unchanged'};}
    if(!response.ok){
      const retry=response.headers.get('retry-after');await response.body?.cancel();
      const delay=retry?/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-Date.now():0;
      throw new NewsFetchError(`Feed returned HTTP ${response.status}`,Math.max(source.pollMs,Number.isFinite(delay)?delay:0));
    }
    if(Number(response.headers.get('content-length'))>MAX_FEED_BYTES){await response.body?.cancel();throw new Error('Feed exceeds size limit');}
    if(!response.body)throw new Error('Feed response has no body');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    try{while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>MAX_FEED_BYTES)throw new Error('Feed exceeds size limit');chunks.push(chunk.value);}}finally{await reader.cancel();}
    const collected_at=new Date().toISOString();
    const xml=Buffer.concat(chunks).toString('utf8');
    return {status:'modified',collected_at,page:parseNewsFeed(xml,source),validators:{...(response.headers.get('etag')?{etag:response.headers.get('etag')!}:{}),...(response.headers.get('last-modified')?{lastModified:response.headers.get('last-modified')!}:{})}};
  }
  throw new Error('Too many feed redirects');
}
