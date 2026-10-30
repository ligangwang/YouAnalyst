'use client';
import {useEffect,useState,type RefObject} from 'react';

/** Start optional data work only when its consumer enters the viewport. */
export function useVisibleDemand<T extends HTMLElement>(ref:RefObject<T|null>,mounted=true) {
 const [visible,setVisible]=useState(false);
 useEffect(()=>{
  const element=ref.current;if(!element||!mounted||visible)return;
  if(typeof IntersectionObserver==='undefined'){
   const frame=requestAnimationFrame(()=>setVisible(true));return()=>cancelAnimationFrame(frame);
  }
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}
  });
  observer.observe(element);return()=>observer.disconnect();
 },[ref,mounted,visible]);
 return visible;
}


