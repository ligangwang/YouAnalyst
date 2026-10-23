"use client";
import { useSyncExternalStore, useEffect, useMemo } from 'react';
import { catalogThemeIds, catalogThemeName, validateThemeCatalog, type ThemeCatalog } from '@/lib/company-themes/catalog-model';

const empty: ThemeCatalog=[];
let nodes: ThemeCatalog=empty, pending: Promise<void>|undefined, expires=0;
const listeners=new Set<()=>void>();
const subscribe=(notify:()=>void)=>{listeners.add(notify);return ()=>{listeners.delete(notify);};};
const snapshot=()=>nodes;
const serverSnapshot=()=>empty;
async function refresh(){
  if(pending || Date.now()<expires)return pending;
  pending=(async()=>{
    try {
      const response=await fetch('/api/investment-themes',{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Catalog unavailable');
      nodes=validateThemeCatalog((await response.json()).nodes);
      expires=Date.now()+60_000;
      listeners.forEach(notify=>notify());
    } catch { /* A transient error never replaces a previously validated catalog. */ }
  })().finally(()=>{pending=undefined;});
  return pending;
}
export function useThemeCatalog(){
  const catalog=useSyncExternalStore(subscribe,snapshot,serverSnapshot);
  useEffect(()=>{
    void refresh();
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60_000);
    document.addEventListener('visibilitychange',visible);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[]);
  return useMemo(()=>({nodes:catalog,themes:catalogThemeIds(catalog),themeName:(id:string,chinese=false)=>catalogThemeName(catalog,id,chinese)}),[catalog]);
}
