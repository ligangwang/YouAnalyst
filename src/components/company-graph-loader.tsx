"use client";

import {lazy,useEffect} from 'react';
import {parseIndustryView} from '@/lib/knowledge-graph/views';

let request:Promise<typeof import('./company-graph-3d')>|undefined;
export function primeCompanyGraph(module:typeof import('./company-graph-3d')){
  request??=Promise.resolve(module);
}
function loadCompanyGraph(){
  return request??=import('./company-graph-3d').catch(error=>{request=undefined;throw error;});
}
// Begin at module evaluation, before hydration/effects can wait on streamed data.
if(typeof window!=='undefined'&&(parseIndustryView(new URLSearchParams(window.location.search).get('view'))??'graph')==='graph'){
  void loadCompanyGraph().catch(()=>{});
}
export const CompanyGraph3D=lazy(loadCompanyGraph);

/** Start the same import used by React.lazy while the snapshot is still loading. */
export function PreloadCompanyGraph({enabled=true}:{enabled?:boolean}){
  useEffect(()=>{if(enabled)void loadCompanyGraph().catch(()=>{});},[enabled]);
  return null;
}
