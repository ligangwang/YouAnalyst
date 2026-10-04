'use client';
import type {CompanyAnnouncement} from '@/lib/events/company-announcements';
import {useLocale} from './providers/locale-provider';

export function CompanyAnnouncements({items}:{items:CompanyAnnouncement[]}){
  const {text}=useLocale();
  if(!items.length)return null;
  const earnings=items.find(item=>item.earnings);
  const filing=items.find(item=>item.form&&/^(?:10-Q|10-K|20-F|40-F)(?:\/A)?$/.test(item.form));
  const selected=[...new Map([earnings,filing,...items.slice(0,3)].filter((item):item is CompanyAnnouncement=>Boolean(item)).map(item=>[item.id,item])).values()];
  return <section className="my-5 border-y border-white/10 py-4" aria-label={text('Company announcements','公司公告')}>
    <h2 className="text-base font-semibold">{text('Latest company announcements','最新公司公告')}</h2>
    <ul className="mt-2 space-y-2 text-sm">{selected.map(item=><li key={item.id} className="flex flex-wrap gap-x-3 gap-y-1">
      <span className="text-slate-400 tabular-nums">{item.date} · {item.channel==='Exchange'?text('Exchange filing','交易所公告'):item.channel}</span>
      <a className="text-cyan-200 hover:underline" href={item.url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a>
      {item.earnings&&<span className="text-teal-300">{text('Earnings','业绩')}</span>}
    </li>)}</ul>
  </section>;
}
