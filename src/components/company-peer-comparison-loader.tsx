'use client';
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import type {PeerComparison} from '@/lib/peer-comparison/model';
import {useLocale} from './providers/locale-provider';
const Comparison=lazy(()=>import('./company-peer-comparison').then(module=>({default:module.CompanyPeerComparison})));

/** Offscreen comparisons do no server work and add no data to the HTML payload. */
export function CompanyPeerComparisonLoader({companyId}:{companyId:string}){
 return <VisibleComparison key={companyId} companyId={companyId}/>;
}
function VisibleComparison({companyId}:{companyId:string}){
 const {text}=useLocale(),container=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false),[retry,setRetry]=useState(0);
 const [state,setState]=useState<{data?:PeerComparison|null;error?:boolean}>({});
 useEffect(()=>{
  if(!container.current)return;
  if(typeof IntersectionObserver==='undefined'){const frame=requestAnimationFrame(()=>setVisible(true));return()=>cancelAnimationFrame(frame);}
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}});
  observer.observe(container.current);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  if(!visible)return;
  let active=true;const controller=new AbortController();
  void fetch(`/api/company-peer-comparison?${new URLSearchParams({company:companyId})}`,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('Comparison unavailable');
   const {data}=await response.json() as {data:PeerComparison|null};
   if(active)setState({data});
  }).catch(()=>{if(active)setState({error:true});});
  return()=>{active=false;controller.abort();};
 },[companyId,visible,retry]);
 const loading=<p role="status" className="py-6 text-sm text-slate-400">{text('Loading peer comparison…','正在加载同业对比…')}</p>;
 return <div ref={container} data-peer-comparison-demand className="min-h-px">
  {visible&&(state.error?<button type="button" onClick={()=>{setState({});setRetry(value=>value+1);}} className="py-6 text-sm text-slate-400">{text('Retry peer comparison','重试同业对比')}</button>
   :state.data===undefined?loading:state.data&&(state.data.panels.length||state.data.pricePeers?.length)?<Suspense fallback={loading}><Comparison data={state.data}/></Suspense>:null)}
 </div>;
}
