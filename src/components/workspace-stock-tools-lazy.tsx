"use client";
import {lazy,Suspense,useState,type ComponentProps} from 'react';
import {useIndustryBrowseParam} from './industry-browse-state';
import {LoadingSpinner} from './loading-spinner';

const Tools=lazy(()=>import('./workspace-stock-tools').then(module=>({default:module.WorkspaceStockTools})));
type Props=ComponentProps<typeof import('./workspace-stock-tools').WorkspaceStockTools>;
/** Keep settings state after first use, without downloading chart tools on entry. */
export function DeferredWorkspaceStockTools(props:Props){
  const watchlist=useIndustryBrowseParam('chartWatchlist')==='1';
  const requested=Boolean(props.anchor)||watchlist;
  const [opened,setOpened]=useState(requested);
  if(requested&&!opened)setOpened(true);
  return opened?<Suspense fallback={<LoadingSpinner/>}><Tools {...props}/></Suspense>:null;
}
