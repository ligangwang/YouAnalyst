"use client";

import { PrivateValuationDisplay } from './private-valuation';
import Image from 'next/image';
import { useMemo, useState } from 'react';
import { companyName, type GraphNode } from '@/lib/knowledge-graph/model';
import { companySectors } from '@/lib/knowledge-graph/views';
import { marketCapLabel, marketCapDescription } from '@/lib/knowledge-graph/market-cap';
import { useLocale } from './providers/locale-provider';
import styles from './ai-knowledge-graph.module.css';

type Props = { companies: GraphNode[]; selected: string; onSelect: (id: string) => void; followedIds: string[] };
const flags = new Set(['CA','CN','FR','GB','IE','NL','SG','TW','US']);
function Name({company, followed}: {company: GraphNode; followed: boolean}) {
 const {locale, text} = useLocale();
 return <>{company.country && flags.has(company.country) && <Image src={`/flags/${company.country.toLowerCase()}.svg`} width={16} height={12} unoptimized alt="" className={styles.listFlag}/>}<span>{companyName(company,locale)}</span>{followed && <span aria-label={text('Following','已关注')} className={styles.followStar}>★</span>}</>;
}
export function IndustryCompanyTable({companies, selected, onSelect, followedIds}: Props) {
 const {text, locale}=useLocale();
 const [sort,setSort]=useState<{key:'name'|'symbol'|'market'|'sector'|'cap';desc:boolean}>({key:'name',desc:false});
 const market=(c:GraphNode)=>c.market==='US'?text('US-listed','美股'):c.market==='CN_A'?text('China A-shares','A股'):text('Other / private','其他／非上市');
 const rows=useMemo(()=>[...companies].sort((a,b)=>{
   if(sort.key==='cap') { const av=a.marketCap?.value,bv=b.marketCap?.value; if(av==null)return bv==null?a.id.localeCompare(b.id):1;if(bv==null)return -1;return (av-bv)*(sort.desc?-1:1)||a.id.localeCompare(b.id); }
   const value=(c:GraphNode)=>sort.key==='name'?companyName(c,locale):sort.key==='sector'?companySectors(c).map(s=>locale==='zh-CN'?s.zh:s.en).join(', '):sort.key==='market'?c.market??'':c.symbol??'';
   return value(a).localeCompare(value(b),locale,{numeric:true})*(sort.desc?-1:1)||a.id.localeCompare(b.id);
 }),[companies,sort,locale]);
 const columns=[['name',text('Company','公司')],['symbol',text('Ticker','股票代码')],['market',text('Listing market','上市市场')],['sector',text('Industry roles','产业环节')],['cap',text('Market value','公司价值')]] as const;
 return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={text('Company list','公司列表')}><table className={styles.companyTable}><caption>{text('Select a company to view details. Public market caps are in USD and use stored closing prices. Private valuations show the disclosed currency and funding date. Value sorting orders public market caps, with private companies last.','点击公司查看详情；上市公司市值以美元计价，基于已存储收盘价估算。私人公司估值显示披露币种和融资日期。价值排序按上市公司市值排列，私人公司列在最后。')}</caption><thead><tr>{columns.map(([key,label])=><th key={key} scope="col" aria-sort={sort.key===key?(sort.desc?'descending':'ascending'):'none'}><button onClick={()=>setSort({key,desc:sort.key===key?!sort.desc:key==='cap'})}>{label}{sort.key===key?(sort.desc?' ↓':' ↑'):''}</button></th>)}</tr></thead><tbody>{rows.map(c=><tr key={c.id} data-list-company={c.id} data-selected={selected===c.id}><td><button className={styles.companySelect} aria-pressed={selected===c.id} onClick={()=>onSelect(c.id)}><Name company={c} followed={followedIds.includes(c.id)}/></button></td><td>{c.symbol||'—'}</td><td>{market(c)}</td><td><div className={styles.roleTags}>{companySectors(c).map(s=><span key={s.id} style={{color:s.color}}>{text(s.en,s.zh)}</span>)}</div></td><td title={marketCapDescription(c.marketCap,locale)}>{c.privateValuation ? <PrivateValuationDisplay valuation={c.privateValuation}/> : <>{marketCapLabel(c.marketCap)||'—'}{c.marketCap && <small>{text('USD','美元')} · {text('As of','截至')} {c.marketCap.priceDate}</small>}</>}</td></tr>)}</tbody></table></div>;
}
