"use client";

import Image from 'next/image';
import { useId, useMemo, useState } from 'react';
import { companyName, type GraphNode } from '@/lib/knowledge-graph/model';
import { companySectors } from '@/lib/knowledge-graph/views';
import { GRAPH_SECTORS, OTHER_SECTOR } from '@/lib/knowledge-graph/sectors';
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
 const columns=[['name',text('Company','公司')],['symbol',text('Ticker','股票代码')],['market',text('Listing market','上市市场')],['sector',text('Industry roles','产业环节')],['cap',text('Est. market cap (USD)','估算市值（美元）')]] as const;
 return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={text('Company list','公司列表')}><table className={styles.companyTable}><caption>{text('Select a company to view details. Market caps use stored closing prices.','点击公司查看详情；市值基于已存储的收盘价估算。')}</caption><thead><tr>{columns.map(([key,label])=><th key={key} scope="col" aria-sort={sort.key===key?(sort.desc?'descending':'ascending'):'none'}><button onClick={()=>setSort({key,desc:sort.key===key?!sort.desc:key==='cap'})}>{label}{sort.key===key?(sort.desc?' ↓':' ↑'):''}</button></th>)}</tr></thead><tbody>{rows.map(c=><tr key={c.id} data-list-company={c.id} data-selected={selected===c.id}><td><button className={styles.companySelect} aria-pressed={selected===c.id} onClick={()=>onSelect(c.id)}><Name company={c} followed={followedIds.includes(c.id)}/></button></td><td>{c.symbol||'—'}</td><td>{market(c)}</td><td><div className={styles.roleTags}>{companySectors(c).map(s=><span key={s.id} style={{color:s.color}}>{text(s.en,s.zh)}</span>)}</div></td><td title={marketCapDescription(c.marketCap,locale)}>{marketCapLabel(c.marketCap)||'—'}{c.marketCap && <small>{text('As of','截至')} {c.marketCap.priceDate}</small>}</td></tr>)}</tbody></table></div>;
}
export function IndustryStructure({companies, selected, onSelect, followedIds}: Props) {
 const {text,locale}=useLocale();
 const branchId=useId();
 const [rootOpen,setRootOpen]=useState(false);
 const [closed,setClosed]=useState<string[]>([...GRAPH_SECTORS,OTHER_SECTOR].map(s=>s.id));
 const groups=[...GRAPH_SECTORS,OTHER_SECTOR].map(s=>({...s,companies:companies.filter(c=>companySectors(c).some(role=>role.id===s.id)).sort((a,b)=>companyName(a,locale).localeCompare(companyName(b,locale),locale))})).filter(s=>s.companies.length);
 return <section className={styles.structure} aria-label={text('Industry structure','产业结构')}><div className={styles.structureRoot}><div><h2><button className={styles.rootToggle} aria-expanded={rootOpen} aria-controls={branchId} onClick={()=>setRootOpen(open=>!open)}>{text('AI industry chain','AI 产业链')} <span aria-hidden="true">{rootOpen?'−':'+'}</span></button></h2><p>{companies.length} {text('unique companies · Companies may appear in multiple branches','家去重公司 · 公司可出现在多个分支')}</p></div><div className={styles.branchActions}><button onClick={()=>{setRootOpen(true);setClosed([]);}}>{text('Expand all','全部展开')}</button><button onClick={()=>{setRootOpen(false);setClosed([...GRAPH_SECTORS,OTHER_SECTOR].map(s=>s.id));}}>{text('Collapse all','全部折叠')}</button></div></div><div id={branchId} hidden={!rootOpen} className={styles.structureBranches}>{groups.map(s=><section key={s.id} className={styles.structureBranch} style={{borderColor:s.color+'55'}}><h3><button aria-expanded={!closed.includes(s.id)} aria-controls={`${branchId}-${s.id}`} onClick={()=>setClosed(prev=>prev.includes(s.id)?prev.filter(id=>id!==s.id):[...prev,s.id])}><i style={{background:s.color}} aria-hidden="true"/><span>{text(s.en,s.zh)}</span><small>{s.companies.length}</small><span aria-hidden="true">{closed.includes(s.id)?'+':'−'}</span></button></h3><ul id={`${branchId}-${s.id}`} hidden={closed.includes(s.id)}>{s.companies.map(c=><li key={c.id}><button data-tree-company={c.id} aria-pressed={selected===c.id} onClick={()=>onSelect(c.id)}><strong><Name company={c} followed={followedIds.includes(c.id)}/></strong><small>{[c.symbol,marketCapLabel(c.marketCap)].filter(Boolean).join(' · ')||text('Private / unlisted','非上市')}</small></button></li>)}</ul></section>)}</div></section>;
}
