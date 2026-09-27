"use client";

import { useEffect, useRef, useState } from 'react';

// Keep the selected card mounted during its exit; reopening cancels that exit.
export function useCardDismiss() {
  const [closing,setClosing]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);},[]);
  function cancel(){
    if(timer.current!==null)clearTimeout(timer.current);
    timer.current=null;setClosing(false);
  }
  function dismiss(done:()=>void){
    if(timer.current!==null)return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){done();return;}
    setClosing(true);
    timer.current=setTimeout(()=>{timer.current=null;setClosing(false);done();},140);
  }
  return {closing,cancel,dismiss};
}
