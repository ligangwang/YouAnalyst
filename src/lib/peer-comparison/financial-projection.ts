// Keep only the observations used by buildPeerComparison; discard histories and filings.
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const pick=(value:unknown,keys:string[])=>Object.fromEntries(keys.filter(key=>record(value)[key]!==undefined).map(key=>[key,record(value)[key]]));
function annual(value:unknown){
 const row=record(value);
 return {...pick(row,['end']),report:pick(row.report,['end','form']),metrics:Array.isArray(row.metrics)?row.metrics.filter(metric=>['Revenue','Net income','Net income attributable to parent','Diluted EPS'].includes(String(record(metric).label))).map(metric=>pick(metric,['label','value','unit','start','end','sourceUrl'])):[]};
}
export function peerFinancialProjection(value:unknown):Record<string,unknown>{
 const row=record(value),cap=record(row.marketCap??record(row.value).marketCap);
 return {isDeleted:row.isDeleted===true,marketCap:{...pick(cap,['status','currency','value','priceDate','close']),shares:pick(cap.shares,['sourceUrl','aTradableShares','aShares'])},value:annual(row.value),cnAnnual:annual(row.cnAnnual)};
}
