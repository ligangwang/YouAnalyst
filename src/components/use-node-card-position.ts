"use client";

import { useEffect, useRef } from 'react';

// Keep an overlay beside its projected node, inside the visible part of the scene.
export function useNodeCardPosition(companyId:string, kind:'graph'|'tree', enabled=true){
  const card=useRef<HTMLElement>(null);
  useEffect(()=>{
    const element=card.current;if(!element||!enabled)return;
    const host=element.closest<HTMLElement>(kind==='tree'?'[data-industry-tree]':'[data-view="graph"]');
    if(!host)return;
    let frame=0;
    const place=()=>{
      if(!element.isConnected)return;
      const scene=kind==='tree'?host:host.querySelector<HTMLElement>('[data-graph-interaction]');
      const bounds=scene?.getBoundingClientRect(),origin=host.getBoundingClientRect();
      if(bounds&&bounds.width&&bounds.height){
        const viewport=window.visualViewport;
        const left=Math.max(bounds.left,viewport?.offsetLeft??0)+10;
        const top=Math.max(bounds.top,viewport?.offsetTop??0)+10;
        const right=Math.min(bounds.right,(viewport?.offsetLeft??0)+(viewport?.width??innerWidth))-10;
        const bottom=Math.min(bounds.bottom,(viewport?.offsetTop??0)+(viewport?.height??innerHeight))-10;
        if(right>left&&bottom>top){
          const width=Math.min(360,right-left),maxHeight=Math.min(520,(bottom-top)*.72);
          element.style.width=`${width}px`;element.style.maxHeight=`${maxHeight}px`;
          let height=Math.min(element.offsetHeight,maxHeight);
          const attr=kind==='tree'?'data-tree-company':'data-company-id';
          const labels=[...host.querySelectorAll<HTMLElement>(`[${attr}]`)].filter(el=>el.getAttribute(attr)===companyId);
          const boxes=labels.map(el=>el.getBoundingClientRect());
          const node=boxes.find(b=>b.right>=left&&b.left<=right&&b.bottom>=top&&b.top<=bottom);
          let x=left+(right-left-width)/2,y=top+(bottom-top-height)/2;
          if(node){
            const cx=(node.left+node.right)/2,cy=(node.top+node.bottom)/2;
            if(node.right+12+width<=right){x=node.right+12;y=cy-height/2;}
            else if(node.left-12-width>=left){x=node.left-12-width;y=cy-height/2;}
            else {
              // On narrow screens keep the selected label tappable: let the card
              // scroll in the larger space above/below it instead of covering it.
              const below=Math.max(0,bottom-node.bottom-12),above=Math.max(0,node.top-12-top);
              const placeBelow=height<=below||(height>above&&below>=above);
              const available=placeBelow?below:above;
              if(available>0&&height>available){height=available;element.style.maxHeight=`${available}px`;}
              x=cx-width/2;y=placeBelow?node.bottom+12:node.top-12-height;
            }
          }
          element.style.left=`${Math.max(left,Math.min(right-width,x))-origin.left}px`;
          element.style.top=`${Math.max(top,Math.min(bottom-height,y))-origin.top}px`;
          element.style.right='auto';element.style.bottom='auto';
          element.setAttribute('data-node-card',companyId);
        }
      }
      frame=requestAnimationFrame(place);
    };
    place();
    return ()=>{
      cancelAnimationFrame(frame);
      for(const property of ['left','top','right','bottom','width','max-height'])element.style.removeProperty(property);
      element.removeAttribute('data-node-card');
    };
  },[companyId,kind,enabled]);
  return card;
}
