"use client";

import {lazy,useEffect} from 'react';

let request:Promise<typeof import('./company-graph-3d')>|undefined;
function loadCompanyGraph(){
  return request??=import('./company-graph-3d').catch(error=>{request=undefined;throw error;});
}
export const CompanyGraph3D=lazy(loadCompanyGraph);

/** Start the same import used by React.lazy while the snapshot is still loading. */
export function PreloadCompanyGraph({enabled=true}:{enabled?:boolean}){
  useEffect(()=>{if(enabled)void loadCompanyGraph().catch(()=>{});},[enabled]);
  return null;
}
