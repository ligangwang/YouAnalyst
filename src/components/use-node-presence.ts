"use client";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {tourDelta} from '@/lib/knowledge-graph/tour-motion';

export type NodePresence<T>={node:T;exiting:boolean};
// Keep removed nodes mounted for their exit, and introduce parents before leaves.
// The same clock drives both charts, including speed and reduced motion. Automatic expansion is paused by the caller;
// manual expansion must still finish when the tour is paused.
export function useNodePresence<T extends {id:string}>(nodes:T[],speed:number){
 const [entries,setEntries]=useState<NodePresence<T>[]>([]);
 const desired=useRef(nodes);useLayoutEffect(()=>{desired.current=nodes;},[nodes]);
 const records=useRef(new Map<string,{node:T;exitAt:number|null}>());
 const elapsed=useRef(0),nextEntry=useRef(.6);
 useEffect(()=>{
  let frame=0,last=0;const media=matchMedia('(prefers-reduced-motion: reduce)');
  const tick=(now:number)=>{
   const dt=last?tourDelta((now-last)/1000,speed):0;last=now;
   if(!document.hidden){
    elapsed.current+=dt;
    const clock=elapsed.current, wanted=new Map(desired.current.map(node=>[node.id,node]));
    let changed=false;
    for(const [id,record] of records.current){
     const node=wanted.get(id);
     if(node){if(record.node!==node||record.exitAt!==null){record.node=node;record.exitAt=null;changed=true;}}
     else if(media.matches||record.exitAt!==null&&clock-record.exitAt>=.8){records.current.delete(id);changed=true;}
     else if(record.exitAt===null){record.exitAt=clock;changed=true;}
    }
    {
     const pending=desired.current.filter(node=>!records.current.has(node.id));
     for(const node of pending){
      if(!media.matches&&clock<nextEntry.current)break;
      records.current.set(node.id,{node,exitAt:null});changed=true;
      nextEntry.current=clock+.24;
     }
    }
    if(changed)setEntries([...records.current.values()].map(r=>({node:r.node,exiting:r.exitAt!==null})));
   }
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[speed]);
 return entries;
}
