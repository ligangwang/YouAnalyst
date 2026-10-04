"use client";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {industryTree} from '@/lib/knowledge-graph/industry-tree';
import {companyName,type GraphNode} from '@/lib/knowledge-graph/model';
import {useLocale} from './providers/locale-provider';
import {CompanyCountryFlag} from './company-country-flag';
import {marketCapLabel} from '@/lib/knowledge-graph/market-cap';
import {TreeCompanyCard} from './tree-company-card';
import styles from './industry-hierarchy.module.css';
import {useNodePresence} from './use-node-presence';
import { tourDelta } from '@/lib/knowledge-graph/tour-motion';
type Node={id:string;parent?:string;x:number;y:number;label:string;color:string;company?:GraphNode};
export function IndustryHierarchy({companies,selected,onSelect,closing,embedded=false}:{companies:GraphNode[];selected:string;onSelect:(id:string)=>void;closing:boolean;embedded?:boolean}){
 const {text,locale}=useLocale();
 const speed=2; // Short manual transitions are independent of automatic tour settings.
 const layers=useMemo(()=>industryTree(companies),[companies]);
 const [open,setOpen]=useState<string[]>(['root']);
 const [view,setView]=useState({x:440,y:260,zoom:.8});
 const viewport=useRef<HTMLDivElement>(null),shot=useRef({x:440,y:260,zoom:.8}),drag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
 const initialized=useRef(false),manualFocus=useRef<string|null>(null);
 const pointers=useRef(new Map<number,{x:number;y:number}>()),pinch=useRef<{distance:number;zoom:number}|null>(null);
 const [size,setSize]=useState({width:1000,height:600});
 useEffect(()=>{const el=viewport.current;if(!el)return;const observer=new ResizeObserver(([e])=>{setSize({width:e.contentRect.width,height:e.contentRect.height});if(!initialized.current){initialized.current=true;shot.current={x:300,y:300,zoom:Math.min(.8,e.contentRect.width/650,e.contentRect.height/650)};}});observer.observe(el);return()=>observer.disconnect();},[]);
 const nodes=useMemo(()=>{
  const label=(en:string,zh:string)=>locale==='zh-CN'?zh:en;
  const result:Node[]=[{id:'root',x:30,y:260,label:label('AI industry chain','AI 产业链'),color:'#7dd3fc'}];let row=30;
  if(open.includes('root'))for(const layer of layers){
   const start=row;result.push({id:layer.id,parent:'root',x:330,y:row,label:label(layer.en,layer.zh),color:layer.color});
   if(open.includes(layer.id))for(const branch of layer.branches){
    result.push({id:branch.id,parent:layer.id,x:630,y:row,label:label(branch.en,branch.zh),color:layer.color});
    if(open.includes(branch.id))for(const company of branch.companies){result.push({id:branch.id+'/'+company.id,parent:branch.id,x:930,y:row,label:companyName(company,locale),color:layer.color,company});row+=88;}
    else row+=100;
   }
   row=Math.max(row,start+112);
  }
  // Children are placed first. Recenter ancestors from the deepest level up,
  // so expanding any branch also recenters its layer and the root.
  const children=new Map<string,Node[]>();
  for(const node of result)if(node.parent){const siblings=children.get(node.parent)??[];siblings.push(node);children.set(node.parent,siblings);}
  for(let i=result.length-1;i>=0;i--){const group=children.get(result[i].id);if(group?.length)result[i].y=(group[0].y+group[group.length-1].y)/2;}
  return result;
 },[layers,open,locale]);
 const presence=useNodePresence(nodes,speed);
 const renderedNodes=presence.map(entry=>entry.node);
 useEffect(()=>{
  const id=manualFocus.current;if(!id)return;const node=nodes.find(n=>n.id===id);if(!node)return;
  const children=nodes.filter(n=>n.parent===id),ys=[node.y,...children.map(n=>n.y)],min=Math.min(...ys),max=Math.max(...ys);
  shot.current={x:node.x+(children.length?270:110),y:(min+max)/2+32,zoom:Math.min(1,size.width/(children.length?620:300),size.height/(max-min+150))};manualFocus.current=null;
 },[nodes,size.width,size.height]);
 const latest=useRef({view});useLayoutEffect(()=>{latest.current={view};});
 const stopMotion=useCallback(()=>{shot.current={...latest.current.view};},[]);
 const releasePointer=useCallback((id:number)=>{
  pointers.current.delete(id);drag.current=null;pinch.current=null;
 },[]);
 useEffect(()=>{
  const blur=()=>{pointers.current.clear();drag.current=null;pinch.current=null;};
  window.addEventListener('blur',blur);return()=>window.removeEventListener('blur',blur);
 },[]);
 // Ease only toward a target requested by a click or reset; there is no tour.
 useEffect(()=>{
  let frame=0,last=0;const media=matchMedia('(prefers-reduced-motion: reduce)');
  const tick=(now:number)=>{const dt=last?tourDelta((now-last)/1000):0;last=now;
   if(!drag.current&&!document.hidden){
    const v=latest.current.view,t=shot.current,a=media.matches?1:1-Math.exp(-dt*speed*6);
    if(Math.abs(v.x-t.x)+Math.abs(v.y-t.y)+Math.abs(v.zoom-t.zoom)>.001)setView({x:v.x+(t.x-v.x)*a,y:v.y+(t.y-v.y)*a,zoom:v.zoom+(t.zoom-v.zoom)*a});
   }
   frame=requestAnimationFrame(tick);
  };frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[]);
 useEffect(()=>{const el=viewport.current;if(!el)return;const wheel=(e:WheelEvent)=>{
  if((e.target as Element).closest('[role="dialog"]'))return;e.preventDefault();
  const v=latest.current.view,next={...v,zoom:Math.max(.12,Math.min(2.5,v.zoom*Math.exp(-e.deltaY*.001)))};
  shot.current=next;setView(next);
 };el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
 const company=companies.find(c=>c.id===selected);
 const savedSelectionView=useRef<typeof view|null>(null),previousSelection=useRef('');
 useEffect(()=>{
  if(selected&&!previousSelection.current)savedSelectionView.current={...latest.current.view};
  if(!selected&&previousSelection.current&&savedSelectionView.current){shot.current=savedSelectionView.current;savedSelectionView.current=null;}
  previousSelection.current=selected;
 },[selected]);
 const chartWidth=Math.max(120,size.width-(!embedded&&selected&&size.width>800?364:0)),chartHeight=Math.max(120,size.height-(!embedded&&selected&&size.width<=800?220:0));
 const toggle=(n:Node)=>{
  if(n.company){onSelect(n.company.id);return;}
  const expanded=!open.includes(n.id);
  manualFocus.current=n.id;
  shot.current={...latest.current.view};
  setOpen(v=>expanded?[...v,n.id]:v.filter(id=>id!==n.id&&!id.startsWith(n.id+'/')));
  if(selected)onSelect('');
 };
 return <section className={embedded?styles.embedded:undefined} aria-label={text('Company hierarchy','公司层级图')} data-industry-section="hierarchy">
  <div className={styles.tools}><button onClick={()=>{stopMotion();setOpen(['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]);}}>{text('Expand all','全部展开')}</button><button onClick={()=>{stopMotion();setOpen(['root']);shot.current={x:440,y:260,zoom:.7};}}>{text('Collapse all','全部折叠')}</button><button onClick={()=>{stopMotion();setOpen(['root']);shot.current={x:440,y:260,zoom:.8};}}>{text('Reset view','复位视角')}</button></div>
  <div ref={viewport} className={styles.scene} data-industry-tree="hierarchy" data-tour="manual"
   onPointerDown={e=>{if((e.target as Element).closest('button,aside'))return;stopMotion();pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.current.size===2){const [a,b]=[...pointers.current.values()];pinch.current={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:view.zoom};drag.current=null;}else drag.current={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={e=>{if(pointers.current.has(e.pointerId))pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.current.size===2&&pinch.current){const [a,b]=[...pointers.current.values()];const next={...view,zoom:Math.max(.12,Math.min(2.5,pinch.current.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.current.distance)))};shot.current=next;setView(next);return;}const d=drag.current;if(d){const next={...view,x:d.vx-(e.clientX-d.x)/view.zoom,y:d.vy-(e.clientY-d.y)/view.zoom};shot.current=next;setView(next);}}} onPointerUp={e=>releasePointer(e.pointerId)} onPointerCancel={e=>releasePointer(e.pointerId)} onLostPointerCapture={e=>releasePointer(e.pointerId)}>
   <svg width="100%" height="100%" viewBox={`${view.x-chartWidth/view.zoom/2} ${view.y-chartHeight/view.zoom/2} ${chartWidth/view.zoom} ${chartHeight/view.zoom}`} aria-label={text('Expandable company hierarchy','可展开公司层级图')}>
    {presence.filter(e=>e.node.parent).map(({node:n,exiting})=>{const p=renderedNodes.find(v=>v.id===n.parent);if(!p)return null;return <path className={exiting?styles.exiting:styles.entering} style={{animationDuration:`${.8/speed}s`}} key={n.id} d={`M${p.x+220},${p.y+32} C${p.x+260},${p.y+32} ${n.x-40},${n.y+32} ${n.x},${n.y+32}`} fill="none" stroke={n.color} opacity=".4"/>;})}
    {presence.map(({node:n,exiting})=><foreignObject className={exiting?styles.exiting:styles.entering} style={{x:n.x,y:n.y,transitionDuration:`${.8/speed}s`,animationDuration:`${.8/speed}s`,pointerEvents:exiting?'none':undefined}} key={n.id} x={n.x} y={n.y} width="240" height="76"><button className={styles.node} style={{borderColor:n.color,animationDuration:`${1.6/speed}s`}} aria-expanded={n.company?undefined:open.includes(n.id)} aria-pressed={n.company?selected===n.company.id:undefined} disabled={exiting} data-exiting={exiting} data-hierarchy-node={n.id} data-tree-company={n.company?.id} title={n.label} onClick={()=>toggle(n)}>{n.company&&<CompanyCountryFlag country={n.company.country} locale={locale}/>} {n.label}<small>{n.company?[n.company.symbol,marketCapLabel(n.company.marketCap)].filter(Boolean).join(" · "):open.includes(n.id)?'−':'+'}</small></button></foreignObject>)}
   </svg>
   {!embedded&&company&&<TreeCompanyCard key={company.id} company={company} color="#7dd3fc" closing={closing} onClose={()=>onSelect('')}/>}
  </div><p>{text('Drag to pan · Scroll or pinch to zoom · Click nodes to expand or collapse','拖动平移 · 滚轮或双指缩放 · 点击节点展开或收起')}</p>
 </section>;
}
