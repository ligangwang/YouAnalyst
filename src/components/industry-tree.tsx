"use client";

import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { industryTree } from '@/lib/knowledge-graph/industry-tree';
import { companyName, type GraphNode } from '@/lib/knowledge-graph/model';
import { useLocale } from './providers/locale-provider';
import { UniverseMusicToggle } from './universe-music';
import { TreeCompanyCard } from './tree-company-card';
import { useWheelZoomGate, WheelZoomHint } from './wheel-zoom-gate';
import styles from './industry-tree.module.css';

const Scene=lazy(()=>import('./industry-tree-scene'));
type Props={musicControls?:boolean;companies:GraphNode[];selected:string;onSelect:(id:string)=>void;followedIds:string[];active:boolean;vertical?:boolean;showCard?:boolean;revealCard?:boolean;closing?:boolean;embedded?:boolean};
// Both trees share one page, so each one only starts WebGL once it scrolls into view and pauses its
// render loop while off-screen. Without IntersectionObserver both simply stay live.
function useOnScreen(active:boolean){
  const ref=useRef<HTMLDivElement>(null);
  const [state,setState]=useState({seen:false,onScreen:false});
  useEffect(()=>{
    const element=ref.current;if(!active||!element)return;
    if(typeof IntersectionObserver==='undefined'){let live=true;void Promise.resolve().then(()=>{if(live)setState({seen:true,onScreen:true});});return ()=>{live=false;};}
    const observer=new IntersectionObserver(([entry])=>setState(previous=>({seen:previous.seen||entry.isIntersecting,onScreen:entry.isIntersecting})),{rootMargin:'100px 0px'});
    observer.observe(element);return ()=>observer.disconnect();
  },[active]);
  return [ref,state] as const;
}
function IconButton({label,onClick,children}:{label:string;onClick:()=>void;children:ReactNode}){
  return <button type="button" aria-label={label} title={label} onClick={onClick}><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg></button>;
}
export function IndustryStructure({musicControls=false,companies,selected,onSelect,followedIds,active,vertical=false,showCard=true,revealCard=false,closing=false,embedded=false}:Props){
  const {text,locale}=useLocale();
  const company=companies.find(c=>c.id===selected);
  const layers=useMemo(()=>industryTree(companies),[companies]);
  // Show the complete trunk immediately; grow company layers within the fixed overview.
  const [open,setOpen]=useState<string[]>(()=>vertical?['root']:['root',...layers.map(l=>l.id)]);
  useEffect(()=>{
    if(!vertical)return;
    const media=matchMedia('(prefers-reduced-motion: reduce)');let live=true;
    const update=()=>{if(live&&media.matches)setOpen(['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]);};
    queueMicrotask(update);media.addEventListener('change',update);
    return()=>{live=false;media.removeEventListener('change',update);};
  },[vertical,layers]);
  const revealLayer=useCallback((id:string)=>{const layer=layers.find(l=>l.id===id);if(layer)setOpen(current=>[...new Set([...current,'root',id,...layer.branches.map(b=>b.id)])]);},[layers]);
  const [focus,setFocus]=useState('');
  const [request,setRequest]=useState(0);
  const [unavailable,setUnavailable]=useState(false);
  const tour=useRef(vertical);
  const showFallback=useCallback(()=>setUnavailable(true),[]);
  const [sceneRef,{seen,onScreen}]=useOnScreen(active);
  const [wheelGateRef,wheelHint]=useWheelZoomGate();
  const attachScene=useCallback((element:HTMLDivElement|null)=>{sceneRef.current=element;wheelGateRef(element);},[sceneRef,wheelGateRef]);
  const headingId=useId();
  function toggle(id:string){
    const closing=open.includes(id);
    setOpen(current=>closing?current.filter(key=>key!==id):[...current,id]);
    if(!vertical){setFocus(closing||id==='root'?'':id);setRequest(n=>n+1);}
  }
  return <section className={`${styles.tree} ${vertical?styles.vertical:''} ${embedded?styles.embedded:''}`} aria-labelledby={headingId} data-industry-section={vertical?'vertical':'horizontal'}>
    <header className={styles.toolbar}><div><h2 id={headingId}>{vertical?text('Vertical tree','垂直树状图'):text('Horizontal tree','水平树状图')}</h2><p>{companies.length} {text('unique companies · Five layers','家去重公司 · 五层产业结构')}</p></div><div className={styles.actions}>
      <IconButton label={text('Expand all','全部展开')} onClick={()=>{setOpen(['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]);setFocus('');if(!vertical)setRequest(n=>n+1);}}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></IconButton>
      <IconButton label={text('Collapse all','全部折叠')} onClick={()=>{setOpen([]);setFocus('');if(!vertical)setRequest(n=>n+1);}}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></IconButton>
      {!embedded&&<IconButton label={text('Reset view','复位视角')} onClick={()=>{setFocus('');if(vertical){setOpen(matchMedia('(prefers-reduced-motion: reduce)').matches?['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]:['root']);onSelect('');}setRequest(n=>n+1);}}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4v4h4"/></IconButton>}
    </div></header>
    <div ref={attachScene} className={styles.scene} data-industry-tree={vertical?'vertical':'3d'}>
      {musicControls&&active&&<UniverseMusicToggle/>}
      <WheelZoomHint hint={wheelHint}/>
      {/* Preserve initialized renderers across tabs; hidden trees pause without recreating WebGL contexts. */}
      {seen&&!unavailable&&<Suspense fallback={<p role="status">{text('Loading 3D tree…','正在加载三维树…')}</p>}><Scene tour={tour} paused={!active||!onScreen} vertical={vertical} layers={layers} open={open} focus={focus} request={request} selected={selected} followedIds={followedIds} onRevealLayer={revealLayer} onToggle={toggle} onSelect={onSelect} onUnavailable={showFallback}/></Suspense>}
      {unavailable&&<div className={styles.fallback}><p role="alert">{text('3D is unavailable on this device. Browse the same tree below.','此设备暂时无法显示三维场景，可使用下方层级树。')}</p>{layers.map(l=><details key={l.id} open={open.includes(l.id)}><summary onClick={e=>{e.preventDefault();toggle(l.id);}}>{text(l.en,l.zh)} · {l.companies.length}</summary>{l.branches.map(b=><details key={b.id} open={open.includes(b.id)}><summary onClick={e=>{e.preventDefault();toggle(b.id);}}>{text(b.en,b.zh)} · {b.companies.length}</summary>{b.companies.map(c=><button key={c.id} onClick={()=>onSelect(c.id)}>{companyName(c,locale)}</button>)}</details>)}</details>)}</div>}
      {active&&showCard&&company&&<TreeCompanyCard closing={closing} key={company.id} reveal={revealCard} company={company} color={layers.find(l=>l.companies.some(c=>c.id===company.id))?.color??'#7dd3fc'} onClose={()=>onSelect('')}/>}
    </div>
    <footer className={styles.hint}>{vertical&&<span>{text('Spiral around the tree · Select companies to explore · Reset to replay','沿树干平滑环绕 · 点击公司查看详情 · 重置重新播放')}</span>}{text('Click nodes to expand / collapse · Drag to pan · Scroll or pinch to zoom · Scroll or swipe up and down to move the page','点击节点展开／收起 · 拖动平移 · 滚轮或双指缩放 · 滚动或上下滑动可移动页面')}<span>{text('Energy → Chips → Infrastructure → Models → Applications · Companies can span layers','自底向上：能源 → 芯片 → 基础设施 → 模型 → 应用 · 公司可跨层')}</span></footer>
  </section>;
}

