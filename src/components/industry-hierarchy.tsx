"use client";
import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {industryTree,industryRootLabel,companyTreePath} from '@/lib/ui/knowledge-graph/industry-tree';
import {companyName,type GraphNode} from '@/lib/knowledge-graph/model';
import {useLocale} from './providers/locale-provider';
import {CompanyCountryFlag} from './company-country-flag';
import {CompanyPriceChange} from './company-price-change';
import {TreeCompanyCard} from './tree-company-card';
import styles from './industry-hierarchy.module.css';

type Browse={selection:string;layer:string;branch:string;step:'layers'|'branches'|'companies'};
export function IndustryHierarchy({companies,selected,onSelect,closing,embedded=false}:{companies:GraphNode[];selected:string;onSelect:(id:string)=>void;closing:boolean;embedded?:boolean}){
 const {text,locale}=useLocale();
 const selectedRow=useRef<HTMLButtonElement>(null);
 const root=useRef<HTMLElement>(null);
 const layers=useMemo(()=>industryTree(companies),[companies]);
 const path=companyTreePath(layers,selected);
 const [browse,setBrowse]=useState<Browse>(()=>({selection:selected,layer:path?.open[1]??layers[0]?.id??'',branch:path?.open[2]??'',step:selected?'companies':'layers'}));
 if(browse.selection!==selected)setBrowse(current=>({...current,selection:selected,...(path?{layer:path.open[1],branch:path.open[2]??'',step:'companies' as const}:{})}));
 const layer=layers.find(item=>item.id===browse.layer)??layers[0];
 const branch=layer?.branches.find(item=>item.id===browse.branch);
 const members=branch?.companies??layer?.companies??[];
 useEffect(()=>{const target=!embedded&&window.matchMedia('(max-width:850px)').matches?root.current?.querySelector<HTMLElement>('[role=dialog]'):selectedRow.current;target?.scrollIntoView({block:'nearest',inline:'nearest'});},[selected,layer?.id,branch?.id,browse.step,embedded]);
 const label=(item:{en:string;zh:string})=>locale==='zh-CN'?item.zh:item.en;
 const company=companies.find(item=>item.id===selected);
 const chooseLayer=(id:string)=>{const next=layers.find(item=>item.id===id);setBrowse({selection:'',layer:id,branch:'',step:next?.directCompanies?'companies':'branches'});if(selected)onSelect('');};
 const back=()=>setBrowse(current=>({...current,step:current.step==='companies'&&!layer?.directCompanies?'branches':'layers'}));
 return <section ref={root} className={`${styles.hierarchy} ${embedded?styles.embedded:''}`} aria-label={text('Company hierarchy','公司层级图')} data-industry-section="hierarchy" data-step={browse.step}>
  <header className={styles.heading}><div><span>{text('INDUSTRY EXPLORER','产业探索')}</span><h2>{industryRootLabel(layers,locale)}</h2></div><button onClick={()=>{setBrowse({selection:'',layer:layers[0]?.id??'',branch:'',step:'layers'});onSelect('');}}>{text('Reset view','复位视角')}</button></header>
  <div className={styles.mobileHeading}><button onClick={back}>← {text('Back','返回')}</button><h2>{layer?branch?label(branch):label(layer):text('Companies','公司')}</h2><p>{members.length} {text('companies','家公司')}</p></div>
  <div className={styles.columns} data-industry-tree="hierarchy">
   <nav className={styles.layers} aria-label={text('Industry sectors','产业板块')}><h3>{text('Sectors','板块')}</h3>{layers.map(item=><button key={item.id} data-hierarchy-node={item.id} aria-expanded={layer?.id===item.id} onClick={()=>chooseLayer(item.id)} style={{'--sector-color':item.color} as CSSProperties}><span>{label(item)}</span><small>{item.companies.length}</small><span aria-hidden="true">›</span></button>)}</nav>
   {layer&&!layer.directCompanies&&<nav className={styles.branches} aria-label={text('Sector categories','板块分类')}><h3>{label(layer)}</h3><button aria-pressed={!branch} onClick={()=>setBrowse(current=>({...current,branch:'',step:'companies'}))}>{text('All companies','全部公司')} <small>{layer.companies.length}</small></button>{layer.branches.map(item=><button key={item.id} data-hierarchy-node={item.id} aria-expanded={branch?.id===item.id} onClick={()=>setBrowse(current=>({...current,branch:item.id,step:'companies'}))}><span>{label(item)}</span><small>{item.companies.length}</small><span aria-hidden="true">›</span></button>)}</nav>}
   <section className={styles.companies} aria-label={text('Sector companies','板块公司')}><h3>{branch?label(branch):text('Companies','公司')} <small>{members.length}</small></h3><div className={styles.companyList}>{members.map(item=><button ref={selected===item.id?selectedRow:undefined} key={item.id} data-tree-company={item.id} data-hierarchy-node={`${branch?.id??layer?.id}/${item.id}`} aria-pressed={selected===item.id} onClick={()=>onSelect(item.id)}><CompanyCountryFlag country={item.country} locale={locale}/><span><strong>{companyName(item,locale)}</strong><small>{item.symbol}</small></span><CompanyPriceChange price={item.dailyPrice} locale={locale}/><span aria-hidden="true">›</span></button>)}</div>{!members.length&&<p>{text('No companies in this sector yet.','此板块暂无公司。')}</p>}</section>
  </div>
  {!embedded&&company&&<TreeCompanyCard key={company.id} company={company} color={layer?.color??'#7dd3fc'} closing={closing} onClose={()=>onSelect('')}/>}
 </section>;
}
