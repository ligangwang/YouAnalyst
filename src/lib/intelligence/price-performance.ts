import type { IntelligenceEvent } from './model';
import { marketDate, type PredictionMarket } from '../predictions/instrument';

export type PriceBar = { date:string; close:number };
export type DailyPrice = { close:number; currency:'USD'|'CNY'; tradingDate:string; previousTradingDate:string|null; change:number|null };
export type EventPriceReturn = { companyId:string; baselineDate:string; latestDate:string; baselineClose:number; latestClose:number; change:number; dateOnly:boolean };
export const signedPercent = (value:number) => `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
const validDate=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
// Published NYSE calendar through 2028; update when the next calendar is released.
// https://www.nyse.com/trade/hours-calendars
const earlyCloses=new Set(['2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24']);
function closingHour(market:PredictionMarket,day:string){return market==='US'?(earlyCloses.has(day)?13:16):15;}
function localSeconds(market:PredictionMarket,date:Date){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:market==='US'?'America/New_York':'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Number(parts.find(part=>part.type==='hour')?.value)*3600+Number(parts.find(part=>part.type==='minute')?.value)*60+Number(parts.find(part=>part.type==='second')?.value);
}
export function completedCloseDate(market:PredictionMarket,now:Date){
  const day=marketDate(market,now);
  return localSeconds(market,now)>closingHour(market,day)*3600?day:new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
}

export function priceBars(rows:PriceBar[],through:string):PriceBar[]{
  return [...new Map(rows.filter(row=>validDate(row.date)&&row.date<=through&&Number.isFinite(row.close)&&row.close>0).map(row=>[row.date,row])).values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function dailyPrice(bars:PriceBar[],market:PredictionMarket):DailyPrice|undefined{
  const latest=bars.at(-1),previous=bars.at(-2);
  if(!latest)return;
  return {close:latest.close,currency:market==='US'?'USD':'CNY',tradingDate:latest.date,previousTradingDate:previous?.date??null,change:previous?latest.close/previous.close-1:null};
}

/** Daily closes, never a fabricated quote at the announcement's exact time. */
export function eventPriceReturn(event:IntelligenceEvent,companyId:string,bars:PriceBar[],market:PredictionMarket,now=new Date()):EventPriceReturn|undefined{
  if(event.planned||!event.companyIds.includes(companyId))return;
  const exact=event.published_at?new Date(event.published_at):null;
  if(exact&&(!Number.isFinite(exact.getTime())||exact>now))return;
  const day=exact?marketDate(market,exact):event.publication_date;
  if(!validDate(day))return;
  const latest=bars.at(-1);
  if(!latest||day>marketDate(market,now))return;
  // At the closing instant the bar is not yet a completed pre-announcement close.
  const afterClose=Boolean(exact&&localSeconds(market,exact)>closingHour(market,day)*3600);
  const baseline=bars.findLast(bar=>bar.date<day||(afterClose&&bar.date===day));
  // No post-announcement close yet: avoid presenting a zero as a market reaction.
  if(!baseline||latest.date<=baseline.date||latest.date<day)return;
  return {companyId,baselineDate:baseline.date,latestDate:latest.date,baselineClose:baseline.close,latestClose:latest.close,change:latest.close/baseline.close-1,dateOnly:!exact};
}
