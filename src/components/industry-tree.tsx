"use client";

import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { industryTree } from '@/lib/knowledge-graph/industry-tree';
import { companyName, type GraphNode } from '@/lib/knowledge-graph/model';
import { useLocale } from './providers/locale-provider';
import { TreeCompanyCard } from './tree-company-card';
import styles from './industry-tree.module.css';

const Scene=lazy(()=>import('./industry-tree-scene'));
type Props={companies:GraphNode[];selected:string;onSelect:(id:string)=>void;followedIds:string[];active:boolean;vertical?:boolean;showCard?:boolean;revealCard?:boolean};
// Both trees share one page, so each one only starts WebGL once it scrolls into view and pauses its
// render loop while off-screen. Without IntersectionObserver both simply stay live.
function useOnScreen(active:boolean){
  const ref=useRef<HTMLDivElement>(null);
  const [state,setState]=useState({seen:false,onScreen:false});
  useEffect(()=>{
    const element=ref.current;if(!active||!element)return;
    if(typeof IntersectionObserver==='undefined'){let live=true;void Promise.resolve().then(()=>{if(live)setState({seen:true,onScreen:true});});return ()=>{live=false;};}
    const observer=new IntersectionObserver(([entry])=>setState(previous=>({seen:previous.seen||entry.isIntersecting,onScreen:entry.isIntersecting})),{rootMargin:'200px 0px'});
    observer.observe(element);return ()=>observer.disconnect();
  },[active]);
  return [ref,state] as const;
}
export function IndustryStructure({companies,selected,onSelect,followedIds,active,vertical=false,showCard=true,revealCard=false}:Props){
  const {text,locale}=useLocale();
  const company=companies.find(c=>c.id===selected);
  const layers=useMemo(()=>industryTree(companies),[companies]);
  const [open,setOpen]=useState<string[]>(()=>vertical?['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]:['root']);
  const [focus,setFocus]=useState('');
  const [request,setRequest]=useState(0);
  const [unavailable,setUnavailable]=useState(false);
  const showFallback=useCallback(()=>setUnavailable(true),[]);
  const [sceneRef,{seen,onScreen}]=useOnScreen(active);
  const headingId=useId();
  function toggle(id:string){
    const closing=open.includes(id);
    setOpen(current=>closing?current.filter(key=>key!==id):[...current,id]);
    setFocus(closing||id==='root'?'':id);setRequest(n=>n+1);
  }
  return <section className={`${styles.tree} ${vertical?styles.vertical:''}`} aria-labelledby={headingId} data-industry-section={vertical?'vertical':'horizontal'}>
    <header className={styles.toolbar}><div><h2 id={headingId}>{vertical?text('Vertical tree','垂直树状图'):text('Horizontal tree','水平树状图')}</h2><p>{companies.length} {text('unique companies · Five layers','家去重公司 · 五层产业结构')}</p></div><div className={styles.actions}>
      <button onClick={()=>{setOpen(['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]);setFocus('');setRequest(n=>n+1);}}>{text('Expand all','全部展开')}</button>
      <button onClick={()=>{setOpen([]);setFocus('');setRequest(n=>n+1);}}>{text('Collapse all','全部折叠')}</button>
      <button onClick={()=>{setFocus('');setRequest(n=>n+1);}}>{text('Reset view','复位视角')}</button>
    </div></header>
    <div ref={sceneRef} className={styles.scene} data-industry-tree={vertical?'vertical':'3d'}>
      {active&&seen&&!unavailable&&<Suspense fallback={<p role="status">{text('Loading 3D tree…','正在加载三维树…')}</p>}><Scene paused={!onScreen} vertical={vertical} layers={layers} open={open} focus={focus} request={request} selected={selected} followedIds={followedIds} onToggle={toggle} onSelect={onSelect} onUnavailable={showFallback}/></Suspense>}
      {unavailable&&<div className={styles.fallback}><p role="alert">{text('3D is unavailable on this device. Browse the same tree below.','此设备暂时无法显示三维场景，可使用下方层级树。')}</p>{layers.map(l=><details key={l.id} open={open.includes(l.id)}><summary onClick={e=>{e.preventDefault();toggle(l.id);}}>{text(l.en,l.zh)} · {l.companies.length}</summary>{l.branches.map(b=><details key={b.id} open={open.includes(b.id)}><summary onClick={e=>{e.preventDefault();toggle(b.id);}}>{text(b.en,b.zh)} · {b.companies.length}</summary>{b.companies.map(c=><button key={c.id} onClick={()=>onSelect(c.id)}>{companyName(c,locale)}</button>)}</details>)}</details>)}</div>}
      {active&&showCard&&company&&<TreeCompanyCard key={company.id} reveal={revealCard} company={company} color={layers.find(l=>l.companies.some(c=>c.id===company.id))?.color??'#7dd3fc'} onClose={()=>onSelect('')}/>}
    </div>
    <footer className={styles.hint}>{text('Click nodes to expand / collapse · Drag to pan · Scroll / pinch to zoom · On touch, swipe up or down to scroll the page','点击节点展开／收起 · 拖动平移 · 双指／滚轮缩放 · 触屏上下滑动可滚动页面')}<span>{text('Energy → Chips → Infrastructure → Models → Applications · Companies can span layers','自底向上：能源 → 芯片 → 基础设施 → 模型 → 应用 · 公司可跨层')}</span></footer>
  </section>;
}
