import type { GraphNode } from '../knowledge-graph/model';
import { companySector, OTHER_SECTOR } from '../knowledge-graph/sectors';
import { mapTimelinePrice } from '../ui/company-timeline';

export const COMPARISON_METRICS = ['marketCap','floatMarketCap','revenue','profit','fiveDayReturn','eps'] as const;
export type ComparisonMetric = typeof COMPARISON_METRICS[number];
export type Observation = { value:number; date:string; start?:string; sourceUrl?:string };
export type PeerCompany = Pick<GraphNode,'id'|'name'|'names'|'symbol'|'slug'>;
export type ComparisonRow = PeerCompany & { observation:Observation|null; rank:number|null };
export type ComparisonPanel = { key:ComparisonMetric; currency:'USD'|'CNY'; date:string; start?:string; annual:boolean; rows:ComparisonRow[]; count:number; mean:number; median:number };
export type PeerComparison = { companyId:string; sector:{en:string;zh:string}; market:'US'|'CN_A'; total:number; panels:ComparisonPanel[] };
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const days=(a:string,b:string)=>Math.abs(Date.parse(a)-Date.parse(b))/86400000;
const source=(v:unknown)=>typeof v==='string'&&v.startsWith('https://')?v:undefined;
export function peerGroup(companyId:string,nodes:GraphNode[]) {
 const current=nodes.find(n=>n.id===companyId&&n.kind==='COMPANY');
 if(!current||current.listingStatus==='PRIVATE')return null;
 const sector=companySector(current);if(sector.id===OTHER_SECTOR.id)return null;
 const market:'US'|'CN_A'|null=companyId.startsWith('US:')?'US':/^(XSHG|XSHE):/.test(companyId)?'CN_A':null;if(!market)return null;
 const companies=[...new Map(nodes.filter(n=>n.kind==='COMPANY'&&n.listingStatus!=='PRIVATE'&&(market==='US'?n.id.startsWith('US:'):/^(XSHG|XSHE):/.test(n.id))&&companySector(n).id===sector.id).map(n=>[n.id,n])).values()];
 return {sector:{en:sector.en,zh:sector.zh},market,companies};
}
export function buildPeerComparison(companyId:string,nodes:GraphNode[],financials:Map<string,unknown>,prices:Map<string,Record<string,unknown>[]>,today:string):PeerComparison|null {
 const group=peerGroup(companyId,nodes);if(!group)return null;
 const currency=group.market==='US'?'USD':'CNY';
 const observations=new Map<string,Partial<Record<ComparisonMetric,Observation>>>();
 const priceRows=new Map(group.companies.map(company=>{
  const ticker=group.market==='US'?company.id.slice(3):company.id;
  const bars=(prices.get(company.id)??[]).flatMap(row=>{
   const p=mapTimelinePrice(row,ticker,group.market);if(!p||p.date>today||days(p.date,today)>45)return [];
   // Historical backfills retain raw close separately from the provider-adjusted close.
   // Never interpret an unverified historical split as a five-session loss.
   if(row.adjustedClose!==undefined||row.source==='eodhd-eod')return finite(row.adjustedClose)&&row.adjustedClose>0?[{...p,close:row.adjustedClose}]:[];
   return [p];
  });
  return [company.id,new Map(bars.map(p=>[p.date,p.close]))] as const;
 }));
 const sessions=[...new Set([...priceRows.values()].flatMap(rows=>[...rows.keys()]))].sort().slice(-6);
 for(const company of group.companies){
  const stored=record(financials.get(company.id)),value=record(stored.value),cap=record(stored.marketCap??value.marketCap),shares=record(cap.shares);
  const row:Partial<Record<ComparisonMetric,Observation>>={};observations.set(company.id,row);
  if(cap.status==='estimated'&&cap.currency===currency&&finite(cap.value)&&cap.value>0&&date(cap.priceDate)&&cap.priceDate<=today&&days(cap.priceDate,today)<=14){
   row.marketCap={value:cap.value,date:cap.priceDate,sourceUrl:source(shares.sourceUrl)};
   if(group.market==='CN_A'&&finite(shares.aTradableShares)&&shares.aTradableShares>0&&finite(shares.aShares)&&shares.aTradableShares<=shares.aShares&&finite(cap.close)&&cap.close>0&&Number.isFinite(shares.aTradableShares*cap.close))
    row.floatMarketCap={value:shares.aTradableShares*cap.close,date:cap.priceDate,sourceUrl:source(shares.sourceUrl)};
  }
  const annual=group.market==='CN_A'?record(stored.cnAnnual):value,report=group.market==='CN_A'?annual:record(annual.report);
  const end=report.end,metrics=Array.isArray(annual.metrics)?annual.metrics:[];
  if(date(end)&&end<=today&&days(end,today)<=850)for(const raw of metrics){
   const metric=record(raw),key=metric.label==='Revenue'?'revenue':metric.label===(group.market==='CN_A'?'Net income attributable to parent':'Net income')?'profit':metric.label==='Diluted EPS'&&group.market==='US'&&report.form==='10-K'?'eps':null;
   if(!key||!finite(metric.value)||metric.unit!==(key==='eps'?'USD/shares':currency)||metric.end!==end||!date(metric.start))continue;
   const duration=(Date.parse(end)-Date.parse(metric.start))/86400000;if(duration<350||duration>380)continue;
   row[key]={value:metric.value,date:end,start:metric.start,sourceUrl:source(metric.sourceUrl)};
  }
  const closes=priceRows.get(company.id)!;
  if(sessions.length===6&&days(sessions[5],today)<=14&&sessions.every(session=>closes.has(session)))row.fiveDayReturn={value:(closes.get(sessions[5])!/closes.get(sessions[0])!-1)*100,date:sessions[5],start:sessions[0]};
 }
 const panels:ComparisonPanel[]=[];
 for(const key of COMPARISON_METRICS){
  const all=group.companies.flatMap(company=>{const observation=observations.get(company.id)?.[key];return observation?[observation]:[];});if(!all.length)continue;
  const anchor=observations.get(companyId)?.[key]?.date??all.map(o=>o.date).sort().at(-1)!;
  const annual=['revenue','profit','eps'].includes(key);
  const entries=group.companies.map(company=>{const candidate=observations.get(company.id)?.[key];const observation=candidate&&(annual?days(candidate.date,anchor)<=120:candidate.date===anchor)?candidate:null;return {id:company.id,name:company.name,names:company.names,symbol:company.symbol,slug:company.slug,observation,rank:null as number|null};});
  const available=entries.filter(row=>row.observation).sort((a,b)=>b.observation!.value-a.observation!.value||a.id.localeCompare(b.id));
  for(let i=0;i<available.length;i++)available[i].rank=i&&available[i].observation!.value===available[i-1].observation!.value?available[i-1].rank:i+1;
  const values=available.map(row=>row.observation!.value),sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  panels.push({key,currency,date:anchor,start:key==='fiveDayReturn'?sessions[0]:undefined,annual,rows:[...available,...entries.filter(row=>!row.observation)],count:values.length,mean:values.reduce((s,n)=>s+n/values.length,0),median:sorted.length%2?sorted[middle]:sorted[middle-1]/2+sorted[middle]/2});
 }
 return {companyId,sector:group.sector,market:group.market,total:group.companies.length,panels};
}
