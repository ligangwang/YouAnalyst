import {normalizedCik} from '../industry-classification/sec';
import {validDay} from '../instrument-onboarding/model';

export const SEC_IPO_COLLECTION='sec_ipo_discovery';
export const IPO_FORMS=new Set(['S-1','S-1/A','F-1','F-1/A','424B4','424B1']);
export type Filing={cik:string;accessionNumber:string;form:string;filingDate:string;primaryDocument:string;sourceUrl:string};
export type Listing={cik:string;symbol:string;exchangeMic:string;name:string};
const exchange=(name:unknown)=>name==='Nasdaq'?'XNAS':name==='NYSE'?'XNYS':name==='NYSE American'?'XASE':null;
export const symbolKey=(value:string)=>value.toUpperCase().replace(/-/g,'.');

export function dailyIndexUrl(day:string){
  if(!validDay(day))throw Error('Invalid index day');
  return `https://www.sec.gov/Archives/edgar/daily-index/${day.slice(0,4)}/QTR${Math.ceil(Number(day.slice(5,7))/3)}/master.${day.replaceAll('-','')}.idx`;
}
export function parseDailyIndex(text:string,day:string):Filing[]{
  if(!validDay(day)||!text.includes('CIK|Company Name|Form Type|Date Filed|Filename'))throw Error('Invalid SEC daily index');
  const rows:Filing[]=[];
  for(const line of text.split(/\r?\n/)){
    const [rawCik,,form,filingDate,path]=line.split('|');
    if(!IPO_FORMS.has(form))continue;
    const cik=normalizedCik(rawCik),match=path?.match(/^edgar\/data\/(\d{1,10})\/(\d{10}-\d{2}-\d{6})\.txt$/);
    if(!cik||!match||normalizedCik(match[1])!==cik||filingDate!==day)throw Error('Invalid IPO index identity');
    rows.push({cik,form,filingDate,accessionNumber:match[2],primaryDocument:'',sourceUrl:`https://www.sec.gov/Archives/${path}`});
  }
  return rows.sort((a,b)=>a.cik.localeCompare(b.cik)||a.accessionNumber.localeCompare(b.accessionNumber));
}

/** Both current SEC sources must independently associate the same listing and CIK. */
export function confirmedMappings(mapping:unknown,submission:unknown,cik:string):Listing[]{
  const m=mapping as {fields?:unknown;data?:unknown},s=submission as {cik?:unknown;name?:unknown;tickers?:unknown;exchanges?:unknown};
  if(normalizedCik(s?.cik)!==cik||typeof s.name!=='string'||!s.name.trim()||!Array.isArray(s.tickers)||!Array.isArray(s.exchanges)||s.tickers.length!==s.exchanges.length)throw Error('Invalid SEC issuer metadata');
  if(!Array.isArray(m?.fields)||!Array.isArray(m.data)||!['cik','name','ticker','exchange'].every(key=>(m.fields as unknown[]).includes(key)))throw Error('Invalid SEC listing map');
  const fields=m.fields as string[],bySymbol=new Map<string,Set<string>>(),rows:Listing[]=[];
  for(const row of m.data){
    if(!Array.isArray(row))throw Error('Invalid SEC listing row');
    const id=normalizedCik(row[fields.indexOf('cik')]),ticker=row[fields.indexOf('ticker')],mic=exchange(row[fields.indexOf('exchange')]);
    if(!id||typeof ticker!=='string'||!mic)continue;
    const symbol=symbolKey(ticker),owners=bySymbol.get(symbol)??new Set<string>();owners.add(id);bySymbol.set(symbol,owners);
    if(id===cik&&/^[A-Z0-9][A-Z0-9.]{0,15}$/.test(symbol))rows.push({cik,symbol,exchangeMic:mic,name:s.name.trim()});
  }
  const tickers=s.tickers as unknown[],exchanges=s.exchanges as unknown[];
  return rows.filter(row=>bySymbol.get(row.symbol)?.size===1&&tickers.some((ticker,i)=>typeof ticker==='string'&&symbolKey(ticker)===row.symbol&&exchange(exchanges[i])===row.exchangeMic))
    .filter((row,i,all)=>all.findIndex(other=>other.symbol===row.symbol&&other.exchangeMic===row.exchangeMic)===i);
}

export function resolveProspectuses(submission:unknown,filings:Filing[],cik:string):Filing[]{
  const s=submission as {cik?:unknown;filings?:{recent?:Record<string,unknown>}};
  if(normalizedCik(s?.cik)!==cik)throw Error('SEC submissions CIK mismatch');
  const r=s.filings?.recent;if(!r||!['accessionNumber','form','filingDate','primaryDocument'].every(k=>Array.isArray(r[k])))throw Error('Invalid SEC recent filings');
  const arrays=r as Record<string,string[]>;
  return filings.filter(f=>['424B4','424B1'].includes(f.form)).flatMap(f=>{
    if(arrays.form.some((form,i)=>form==='RW'&&arrays.filingDate[i]>=f.filingDate))return [];
    const i=arrays.accessionNumber.indexOf(f.accessionNumber);if(i<0)return [];
    if(arrays.form[i]!==f.form||arrays.filingDate[i]!==f.filingDate)throw Error('SEC prospectus evidence mismatch');
    const primaryDocument=arrays.primaryDocument[i];
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.html?$/.test(primaryDocument))return [];
    return [{...f,primaryDocument,sourceUrl:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accessionNumber.replaceAll('-','')}/${primaryDocument}`}];
  }).sort((a,b)=>b.filingDate.localeCompare(a.filingDate)).slice(0,3);
}

/** Restrict affirmative evidence to the prospectus cover; historical IPO mentions are insufficient. */
export function confirmsIpoCover(html:string,listing:Listing){
  const cover=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')
    .replace(/&#(?:160|xA0);|&nbsp;/gi,' ').replace(/&#(?:34|x22);|&quot;|[“”]/gi,'"').replace(/\s+/g,' ').slice(0,12000);
  if(!/\bThis is (?:our|the|an) initial public offering\b/i.test(cover))return false;
  if(/\b(?:units? consisting|warrants? included|blank check company|special purpose acquisition company)\b/i.test(cover))return false;
  const micText=listing.exchangeMic==='XNAS'?'Nasdaq':listing.exchangeMic==='XNYS'?'New York Stock Exchange|NYSE':'NYSE American';
  const symbol=listing.symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll('\\.','[.-]');
  const listed=new RegExp(`(?:approved (?:for listing|to list)|(?:is|are|has been) listed).{0,200}(?:${micText}).{0,160}(?:under (?:the )?(?:trading )?symbol)\\s*["']?${symbol}(?=["' ,.;])`,'i');
  return listed.test(cover)&&/\b(?:common stock|common shares|ordinary shares|American depositary shares)\b/i.test(cover);
}
