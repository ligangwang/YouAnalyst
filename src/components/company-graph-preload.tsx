"use client";

import dynamic from 'next/dynamic';
import {primeCompanyGraph} from './company-graph-loader';

// next/dynamic emits server-side script hints for these exact graph chunks.
// Render no canvas: the workspace still owns the only graph renderer.
const GraphResources=dynamic(()=>import('./company-graph-3d').then(module=>{
  primeCompanyGraph(module);
  return function GraphResourcesLoaded(){return null;};
}),{loading:()=>null});

export function PreloadGraphChunks({enabled=true}:{enabled?:boolean}){
  return enabled?<GraphResources/>:null;
}
