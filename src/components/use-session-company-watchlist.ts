"use client";

import {useSyncExternalStore} from 'react';
import {followedCompanyIds} from '@/lib/knowledge-graph/follows';

const key='ya-session-company-watchlist';
const empty:string[]=[];
let snapshot=empty,loaded=false;
const listeners=new Set<()=>void>();
function read(){
 if(!loaded&&typeof window!=='undefined'){
  loaded=true;
  try{snapshot=followedCompanyIds(JSON.parse(sessionStorage.getItem(key)??'[]'));}catch{/* Retain the in-memory session when storage is unavailable. */}
 }
 return snapshot;
}
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const serverSnapshot=()=>empty;
function change(id:string,follow:boolean){
 const current=read();
 if(follow&&!current.includes(id)&&current.length>=200)throw new Error('Watchlist limit reached');
 snapshot=followedCompanyIds(follow?[...current,id]:current.filter(value=>value!==id));
 try{sessionStorage.setItem(key,JSON.stringify(snapshot));}catch{/* The current page still shares the in-memory list. */}
 listeners.forEach(listener=>listener());
}
/** Guest-only, per-tab state; authenticated account IDs never enter this store. */
export function useSessionCompanyWatchlist(){
 return {ids:useSyncExternalStore(subscribe,read,serverSnapshot),change};
}
