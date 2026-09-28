"use client";
import {useEffect,useRef} from 'react';
// Dock at the chart edge. Manual positioning survives changes to the selection.
export function useNodeCardPosition(companyId:string,kind:'graph'|'tree',enabled=true){
 const card=useRef<HTMLElement>(null),position=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{
  const el=card.current;if(!el||!enabled)return;
  const host=el.closest<HTMLElement>(kind==='tree'?'[data-industry-tree]':'[data-view="graph"]');if(!host)return;
  let frame=0,drag:{id:number;x:number;y:number;left:number;top:number}|null=null;
  const place=()=>{
   const r=host.getBoundingClientRect(),width=Math.min(340,r.width-24),height=r.width<=800?200:Math.min(520,innerHeight*.55,r.height-24);
   el.style.width=`${Math.max(160,width)}px`;el.style.maxHeight=`${Math.max(100,height)}px`;
   const left=Math.max(12,-r.left+12),right=Math.max(left,Math.min(r.width-width-12,innerWidth-r.left-width-12));
   const top=Math.max(12,-r.top+12),bottom=Math.max(top,Math.min(r.height-el.offsetHeight-12,innerHeight-r.top-el.offsetHeight-12));
   const p=position.current??{x:right,y:r.width<=800?bottom:top};
   el.style.left=`${Math.max(left,Math.min(right,p.x))}px`;el.style.top=`${Math.max(top,Math.min(bottom,p.y))}px`;
   el.style.right='auto';el.style.bottom='auto';el.dataset.nodeCard=companyId;
   frame=requestAnimationFrame(place);
  };
  const down=(e:PointerEvent)=>{if(e.button!==0||!(e.target instanceof Element)||!e.target.closest('[data-card-drag]')||e.target.closest('button,a,input,select'))return;
   e.preventDefault();e.stopPropagation();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:parseFloat(el.style.left)||0,top:parseFloat(el.style.top)||0};el.setPointerCapture(e.pointerId);};
  const move=(e:PointerEvent)=>{if(!drag||e.pointerId!==drag.id)return;e.preventDefault();position.current={x:drag.left+e.clientX-drag.x,y:drag.top+e.clientY-drag.y};};
  const up=(e:PointerEvent)=>{if(drag?.id===e.pointerId){drag=null;if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);}};
  const key=(e:KeyboardEvent)=>{if(!(e.target instanceof Element)||!e.target.matches('[data-card-drag]'))return;const d=({ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]} as Record<string,number[]>)[e.key];if(d){e.preventDefault();position.current={x:(parseFloat(el.style.left)||0)+d[0],y:(parseFloat(el.style.top)||0)+d[1]};}};
  el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('keydown',key);place();
  return()=>{cancelAnimationFrame(frame);el.removeEventListener('pointerdown',down);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);el.removeEventListener('keydown',key);delete el.dataset.nodeCard;};
 },[companyId,kind,enabled]);
 return card;
}
