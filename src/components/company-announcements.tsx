'use client';
import type {CompanyAnnouncement} from '@/lib/events/company-announcements';
import {useLocale} from './providers/locale-provider';
import type {PublicEarningsSummary} from '@/lib/earnings/public-summary';

export function CompanyAnnouncements({items,earningsSummary}:{items:CompanyAnnouncement[];earningsSummary?:PublicEarningsSummary|null}){
  const {text}=useLocale();
  const readableTitle=(title:string,fallback:string)=>title.split('|').length>=3||/EX-\d/i.test(title)&&/\.html?/i.test(title)?fallback:title;
  if(!items.length&&!earningsSummary)return null;
  const earnings=items.filter(item=>item.earnings).sort((a,b)=>b.date.localeCompare(a.date)||Number(b.channel==='IR')-Number(a.channel==='IR'))[0];
  const matched=earningsSummary?items.find(item=>{
    if(!item.earnings)return false;
    if(item.url===earningsSummary.url)return true;
    const filing=new URL(item.url),source=new URL(earningsSummary.url);
    const accession=(url:URL)=>url.pathname.match(/^\/Archives\/edgar\/data\/\d+\/\d{18}\//)?.[0];
    return filing.hostname==='www.sec.gov'&&source.hostname==='www.sec.gov'&&Boolean(accession(source))&&accession(filing)===accession(source);
  }):undefined;
  const summary=earningsSummary&&(!earnings||(earningsSummary.publishedDate?earningsSummary.publishedDate>=earnings.date:matched&&matched.date>=earnings.date))?earningsSummary:null;
  const release=summary?(summary.publishedDate===earnings?.date?earnings:matched):earnings;
  const filing=items.find(item=>item.form&&/^(?:10-Q|10-K|20-F|40-F)(?:\/A)?$/.test(item.form));
  const selected=[...new Map([earnings,filing,...items.slice(0,3)].filter((item):item is CompanyAnnouncement=>Boolean(item)).map(item=>[item.url,item])).values()].filter((item,index,all)=>all.findIndex(other=>other.date===item.date&&other.title.trim().toLowerCase()===item.title.trim().toLowerCase())===index);
  return <section className="my-5 border-y border-white/10 py-4" aria-label={text('Company announcements','公司公告')}>
    {(earnings||summary)&&<section className="mb-4 rounded-lg border border-teal-400/20 bg-teal-900/10 p-3" aria-label={text('Latest earnings','最新业绩')}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><h2 className="font-semibold text-teal-200">{text('Latest earnings','最新业绩')}{summary&&` · FY${summary.period.fiscalYear}${summary.period.fiscalQuarter?` Q${summary.period.fiscalQuarter}`:''}`}</h2><span className="text-xs text-slate-400">{summary?.publishedDate??release?.date}</span></div>
      {summary&&<><p className="mt-1 text-xs text-slate-400">{text('Period ended','报告期截至')} {summary.period.end} · {text(summary.period.type.replaceAll('_',' '),({quarter:'季度',half_year:'半年',nine_month_ytd:'前三季度',annual:'年度'})[summary.period.type])}</p><dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">{summary.metrics.map(metric=><div key={metric.name}><dt className="text-xs text-slate-400">{text(({revenue:'Revenue',revenue_yoy:'Revenue YoY',revenue_qoq:'Revenue QoQ'})[metric.name],({revenue:'营收',revenue_yoy:'营收同比',revenue_qoq:'营收环比'})[metric.name])} · {metric.basis.replaceAll('_',' ')}</dt><dd className="text-lg font-semibold tabular-nums text-teal-100">{new Intl.NumberFormat('en-US',{notation:metric.unit==='%'?'standard':'compact',maximumFractionDigits:2}).format(metric.value)} {metric.unit}</dd></div>)}</dl></>}
      <a className="mt-2 inline-block text-sm text-cyan-200 hover:underline" href={release?.url??summary!.url} target="_blank" rel="noopener noreferrer">{readableTitle(release?.title??summary!.title,summary?text(`FY${summary.period.fiscalYear}${summary.period.fiscalQuarter?` Q${summary.period.fiscalQuarter}`:''} earnings release`,`FY${summary.period.fiscalYear}${summary.period.fiscalQuarter?` Q${summary.period.fiscalQuarter}`:''} 业绩公告`):text('Earnings release','业绩公告'))} ↗</a>
      {summary&&release&&summary.url!==release.url&&<a className="ml-3 text-xs text-cyan-200 hover:underline" href={summary.url} target="_blank" rel="noopener noreferrer">{text('Financial figures source','财务数据来源')} ↗</a>}
    </section>}
    <h2 className="text-base font-semibold">{text('Latest company announcements','最新公司公告')}</h2>
    <ul className="mt-2 space-y-2 text-sm">{selected.filter(item=>item.url!==release?.url&&!(item.date===release?.date&&item.title.trim().toLowerCase()===release?.title.trim().toLowerCase())).map(item=><li key={item.id} className="flex flex-wrap gap-x-3 gap-y-1">
      <span className="text-slate-400 tabular-nums">{item.date} · {item.channel==='Exchange'?text('Exchange filing','交易所公告'):item.channel}</span>
      <a className="text-cyan-200 hover:underline" href={item.url} target="_blank" rel="noopener noreferrer">{readableTitle(item.title,text('Company announcement','公司公告'))} ↗</a>
      {item.earnings&&<span className="text-teal-300">{text('Earnings','业绩')}</span>}
    </li>)}</ul>
  </section>;
}
