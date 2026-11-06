export type HistoricalBar={date:string;close:number;open:number|null;high:number|null;low:number|null;adjusted_close:number|null;volume:number|null};
const day=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;

/** Partial onboarding needs a real dated close; missing OHLC/volume is not fabricated. */
export function historyBars(value:unknown,from:string,through:string,allowPartial=false):HistoricalBar[]{
  if(!day(from)||!day(through)||through<from)throw Error('Invalid history range');
  if(!Array.isArray(value)||!value.length||value.length>10000)throw Error('Empty or invalid historical response');
  const dates=new Map<string,HistoricalBar>(),conflicts=new Set<string>();
  for(const row of value){
    const usable=row&&typeof row.date==='string'&&day(row.date)&&row.date>=from&&row.date<=through&&positive(row.close);
    const full=usable&&['open','high','low','adjusted_close'].every(key=>positive(row[key]))&&Number.isFinite(row.volume)&&row.volume>=0&&row.high>=Math.max(row.open,row.close,row.low)&&row.low<=Math.min(row.open,row.close);
    if(!allowPartial){if(!full||dates.has(row.date))throw Error('Invalid historical bar');dates.set(row.date,row);continue;}
    if(!usable||conflicts.has(row.date))continue;
    const prior=dates.get(row.date);
    if(prior&&prior.close!==row.close){dates.delete(row.date);conflicts.add(row.date);continue;}
    const ohlc=['open','high','low'].every(key=>positive(row[key]))&&row.high>=Math.max(row.open,row.close,row.low)&&row.low<=Math.min(row.open,row.close);
    const normalized:HistoricalBar={date:row.date,close:row.close,open:ohlc?row.open:null,high:ohlc?row.high:null,low:ohlc?row.low:null,adjusted_close:positive(row.adjusted_close)?row.adjusted_close:null,volume:Number.isFinite(row.volume)&&row.volume>=0?row.volume:null};
    if(!prior||full)dates.set(row.date,normalized);
  }
  if(!dates.size)throw Error('Empty or invalid historical response');
  return [...dates.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
