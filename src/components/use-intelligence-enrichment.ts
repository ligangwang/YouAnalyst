"use client";
import {useCallback,useEffect,useMemo,useState} from 'react';
import type {IntelligenceSnapshot} from '@/lib/intelligence/model';
import {enrichIntelligenceSnapshot,type IntelligenceEnrichment} from '@/lib/intelligence/enrichment-model';

export function useIntelligenceEnrichment(base:IntelligenceSnapshot){
  const key=JSON.stringify([base.theme,base.generatedAt,base.graphVersion,base.feedWindow?.version]);
  const [state,setState]=useState<{key:string;patch:IntelligenceEnrichment;done:string[];failed:string[]}>({key:'',patch:{},done:[],failed:[]});
  const work=useMemo(()=>({key,active:true,scheduled:false,queues:{calendar:new Set<string>(),prices:new Set<string>()},companies:new Set<string>(),done:new Set<string>(),busy:{calendar:false,prices:false},controllers:new Set<AbortController>()}),[key]);
  useEffect(()=>{work.active=true;return()=>{work.active=false;for(const controller of work.controllers)controller.abort();};},[work]);
  const request=useCallback((eventIds:string[],companyIds:string[]=[])=>{
    if(!base.enrichmentDeferred||!work.active||document.visibilityState==='hidden')return;
    for(const id of eventIds){
      const event=base.events.find(event=>event.id===id||event.relatedEventIds?.includes(id));if(!event)continue;
      if(event.calendarPending&&!work.done.has(`calendar:${event.id}`))work.queues.calendar.add(event.id);
      if(!work.done.has(`prices:${event.id}`))work.queues.prices.add(event.id);
    }
    for(const id of companyIds)if(!work.done.has(`company:${id}`))work.companies.add(id);
    if(work.scheduled)return;work.scheduled=true;
    queueMicrotask(()=>{
      work.scheduled=false;
      for(const kind of ['calendar','prices'] as const){
        const run=async()=>{
          if(!work.active||work.busy[kind])return;
          work.busy[kind]=true;
          try{while(work.active&&(work.queues[kind].size||kind==='prices'&&work.companies.size)){
            const ids=[...work.queues[kind]].filter(id=>!work.done.has(`${kind}:${id}`)).slice(0,20);
            for(const id of [...work.queues[kind]])if(work.done.has(`${kind}:${id}`)||ids.includes(id))work.queues[kind].delete(id);
            const companies=kind==='prices'?[...work.companies].filter(id=>!work.done.has(`company:${id}`)).slice(0,20):[];
            if(kind==='prices')for(const id of [...work.companies])if(work.done.has(`company:${id}`)||companies.includes(id))work.companies.delete(id);
            if(!ids.length&&!companies.length)continue;
            const keys=[...ids.map(id=>`${kind}:${id}`),...companies.map(id=>`company:${id}`)];
            // Mark in-flight IDs too, so repeated visibility callbacks coalesce.
            for(const key of keys)work.done.add(key);
            const controller=new AbortController();work.controllers.add(controller);
            const timeout=setTimeout(()=>controller.abort(),15_000);
            try{
              const response=await fetch('/api/intelligence/enrichment',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,
                body:JSON.stringify({theme:base.theme??'ai',snapshotAt:base.generatedAt,kind,eventIds:ids,companyIds:companies})});
              if(!response.ok)throw Error('Details unavailable');
              const patch:IntelligenceEnrichment=await response.json();
              if(patch.snapshotAt!==base.generatedAt)throw Error('Stale details');
              if(!work.active)return;
              for(const id of Object.keys(patch.prices??{})){const key=`company:${id}`;work.done.add(key);keys.push(key);}
              setState(previous=>{const current=previous.key===key?previous:{key,patch:{},done:[],failed:[]};return {key,
                patch:{snapshotAt:base.generatedAt,calendar:{...current.patch.calendar,...patch.calendar},prices:{...current.patch.prices,...patch.prices},eventReturns:{...current.patch.eventReturns,...patch.eventReturns}},
                done:[...new Set([...current.done,...keys])],failed:current.failed.filter(key=>!keys.includes(key))};});
            }catch{
              for(const key of keys)work.done.delete(key);
              if(work.active)setState(previous=>{const current=previous.key===key?previous:{key,patch:{},done:[],failed:[]};return {...current,failed:[...new Set([...current.failed,...keys])]};});
              // Retry is explicit. Do not loop on failing/off-screen requests.
              for(const id of ids)work.queues[kind].delete(id);
            }finally{clearTimeout(timeout);work.controllers.delete(controller);}
          }}finally{work.busy[kind]=false;}
        };
        void run();
      }
    });
  },[base,key,work]);
  const current=state.key===key?state:undefined;
  return {snapshot:useMemo(()=>current?enrichIntelligenceSnapshot(base,current.patch):base,[base,current]),request,
    pending:(kind:'prices'|'calendar'|'company',id:string)=>Boolean(base.enrichmentDeferred&&!current?.done.includes(`${kind}:${id}`)),
    failed:(id:string)=>Boolean(current?.failed.some(key=>key.endsWith(`:${id}`)))};
}
