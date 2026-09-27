import { CN_COMPANY_ID } from '../knowledge-graph/cn-companies';
import type { FundamentalMetric } from './model';

export type CnAnnual = {
  version: 1; companyId: string; end: string; filed: string; updated: string;
  fetchedAt: string; source: 'AKShare/Eastmoney'; sourceUrl: string; metrics: FundamentalMetric[];
};
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(v)
  && Number.isFinite(Date.parse(v.slice(0,10))) && new Date(v.slice(0,10)).toISOString().slice(0,10)===v.slice(0,10) ? v.slice(0,10) : null;
const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
export function akshareSymbol(id:string){
  if(!CN_COMPANY_ID.test(id))throw new Error('Invalid A-share company ID');
  return `${id.startsWith('XSHG:')?'SH':'SZ'}${id.split(':')[1]}`;
}
export function parseCnAnnual(id:string,payload:unknown,now=new Date()):CnAnnual{
  const symbol=akshareSymbol(id),value=payload as {symbol?:unknown;rows?:unknown};
  if(value?.symbol!==symbol||!Array.isArray(value.rows))throw new Error('Invalid AKShare response');
  const today=now.toISOString().slice(0,10);
  const rows=value.rows.filter((r):r is Record<string,unknown>=>Boolean(r&&typeof r==='object'));
  const candidates=rows.flatMap(row=>{
    const end=date(row.REPORT_DATE),filed=date(row.NOTICE_DATE),updated=date(row.UPDATE_DATE)??filed;
    if(!end?.endsWith('-12-31')||!filed||!updated||end>=today||filed>today||filed<end||updated>today)return [];
    if(row.SECURITY_CODE!==symbol.slice(2)||row.SECUCODE!==`${symbol.slice(2)}.${symbol.slice(0,2)}`)return [];
    if(row.REPORT_TYPE!=='年报')return [];
    return [{row,end,filed,updated}];
  }).sort((a,b)=>b.end.localeCompare(a.end)||b.updated.localeCompare(a.updated)||b.filed.localeCompare(a.filed));
  const latest=candidates[0];
  if(!latest)throw new Error('No valid annual consolidated income statement');
  const {row,end,filed,updated}=latest;
  if(!['CNY','人民币','人民币元'].includes(String(row.CURRENCY)))throw new Error('Unsupported annual reporting currency');
  const peers=candidates.filter(r=>r.end===end&&r.updated===updated&&r.filed===filed);
  if(new Set(peers.map(r=>JSON.stringify([r.row.CURRENCY,r.row.OPERATE_INCOME,r.row.PARENT_NETPROFIT]))).size!==1)throw new Error('Ambiguous annual financial values');
  const revenue=numeric(row.OPERATE_INCOME),profit=numeric(row.PARENT_NETPROFIT);
  if(revenue===null||profit===null)throw new Error('Annual revenue or attributable profit is missing');
  const sourceUrl=`https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/Index?type=web&code=${symbol.toLowerCase()}#lrb-0`;
  const metric=(label:string,amount:number,tag:string):FundamentalMetric=>({label,value:amount,unit:'CNY',start:`${end.slice(0,4)}-01-01`,end,filed,sourceUrl,tag});
  return {version:1,companyId:id,end,filed,updated,fetchedAt:now.toISOString(),source:'AKShare/Eastmoney',sourceUrl,
    metrics:[metric('Revenue',revenue,'OPERATE_INCOME'),metric('Net income attributable to parent',profit,'PARENT_NETPROFIT')]};
}
