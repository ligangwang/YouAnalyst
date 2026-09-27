"use client";
import type { CnAnnual } from '@/lib/fundamentals/cn-annual';
import { useLocale } from './providers/locale-provider';

export function ChinaAnnualFinancials({annual,stale=false}:{annual:CnAnnual|null;stale?:boolean}){
  const {text,locale}=useLocale();
  return <section aria-labelledby="cn-annual" className="mt-8 rounded-2xl border border-white/10 p-6 sm:p-8">
    <h2 id="cn-annual" className="text-lg font-semibold">{text('Annual financials','年度财务数据')}</h2>
    {annual?<>
      <p className="mt-2 text-sm text-slate-400">{annual.end.slice(0,4)} · {text('Consolidated annual statements · CNY','年度合并报表 · 人民币元')}</p>
      <dl className="mt-4 grid gap-6 sm:grid-cols-2">{annual.metrics.map(metric=><div key={metric.label}><dt className="text-sm text-slate-400">{metric.label==='Revenue'?text('Annual revenue','年度营业收入'):text('Annual net income attributable to parent','年度归母净利润')}</dt><dd className="mt-2 text-xl">{metric.value===null?text('Unavailable','暂无'):`${new Intl.NumberFormat(locale,{notation:'compact',maximumFractionDigits:2}).format(metric.value)} CNY`}</dd></div>)}</dl>
      <p className="mt-4 text-xs text-slate-400">{text('Published','公告日期')} {annual.filed} · <a className="text-cyan-200" href={annual.sourceUrl} target="_blank" rel="noopener noreferrer">{text('Eastmoney via AKShare','东方财富（AKShare）')} ↗</a></p>
      {stale&&<p className="mt-2 text-xs text-slate-400">{text('Showing an older cached snapshot.','当前显示较早的缓存快照。')}</p>}
    </>:<p className="mt-3 text-slate-400">{text('Annual financials have not been cached yet.','年度财报数据尚未缓存。')}</p>}
  </section>;
}
