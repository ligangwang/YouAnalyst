"use client";
import {useCallback,useEffect,useMemo,useState} from 'react';
import type {IntelligenceSnapshot} from '@/lib/intelligence/model';
import {enrichIntelligenceSnapshot,type IntelligenceEnrichment} from '@/lib/intelligence/enrichment-model';

export function useIntelligenceEnrichment(base:IntelligenceSnapshot){
  const key=JSON.stringify([base.theme,base.generatedAt,base.graphVersion,base.feedWindow?.version]);
  const [state,setState]=useState<{key:string;patch:IntelligenceEnrichment;done:string[];failed:string[]}>({key:'',patch:{},done:[],failed:[]});
  const work=useMemo(()=>({key,active:true,scheduled:false,prices:new Set<string>(),companies:new Set<string>(),done:new Set<string>(),busy:false,controllers:new Set<AbortController>()}),[key]);
  useEffect(()=>{work.active=true;return()=>{work.active=false;for(const controller of work.controllers)controller.abort();};},[work]);
  const request=useCallback((eventIds:string[],companyIds:string[]=[])=>{
    if(!base.enrichmentDeferred||!work.active||document.visibilityState==='hidden')return;
    for(const id of eventIds){
      const event=base.events.find(event=>event.id===id||event.relatedEventIds?.includes(id));if(!event)continue;
      if(!work.done.has(`prices:${event.id}`))work.prices.add(event.id);
    }
    for(const id of companyIds)if(!work.done.has(`company:${id}`))work.companies.add(id);
    if(work.scheduled)return;work.scheduled=true;
    queueMicrotask(()=>{
      work.scheduled=false;
      const run=async()=>{
        if(!work.active||work.busy)return;
        work.busy=true;
        try{while(work.active&&(work.prices.size||work.companies.size)){
          const ids=[...work.prices].filter(id=>!work.done.has(`prices:${id}`)).slice(0,20);
          for(const id of [...work.prices])if(work.done.has(`prices:${id}`)||ids.includes(id))work.prices.delete(id);
          const companies=[...work.companies].filter(id=>!work.done.has(`company:${id}`)).slice(0,20);
          for(const id of [...work.companies])if(work.done.has(`company:${id}`)||companies.includes(id))work.companies.delete(id);
          if(!ids.length&&!companies.length)continue;
          const keys=[...ids.map(id=>`prices:${id}`),...companies.map(id=>`company:${id}`)];
          // Mark in-flight IDs too, so repeated visibility callbacks coalesce.
          for(const key of keys)work.done.add(key);
          const controller=new AbortController();work.controllers.add(controller);
          const timeout=setTimeout(()=>controller.abort(),15_000);
          try{
            const response=await fetch('/api/intelligence/enrichment',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,
              body:JSON.stringify({theme:base.theme??'ai',snapshotAt:base.generatedAt,kind:'prices',eventIds:ids,companyIds:companies})});
            if(!response.ok)throw Error('Details unavailable');
            const patch:IntelligenceEnrichment=await response.json();
            if(patch.snapshotAt!==base.generatedAt)throw Error('Stale details');
            if(!work.active)return;
            for(const id of Object.keys(patch.prices??{})){const key=`company:${id}`;work.done.add(key);keys.push(key);}
            setState(previous=>{const current=previous.key===key?previous:{key,patch:{},done:[],failed:[]};return {key,
              patch:{snapshotAt:base.generatedAt,prices:{...current.patch.prices,...patch.prices},eventReturns:{...current.patch.eventReturns,...patch.eventReturns}},
              done:[...new Set([...current.done,...keys])],failed:current.failed.filter(key=>!keys.includes(key))};});
          }catch{
            for(const key of keys)work.done.delete(key);
            if(work.active)setState(previous=>{const current=previous.key===key?previous:{key,patch:{},done:[],failed:[]};return {...current,failed:[...new Set([...current.failed,...keys])]};});
            // Retry is explicit. Do not loop on failing/off-screen requests.
            for(const id of ids)work.prices.delete(id);
          }finally{clearTimeout(timeout);work.controllers.delete(controller);}
        }}finally{work.busy=false;}
      };
      void run();
    });
  },[base,key,work]);
  const current=state.key===key?state:undefined;
  return {snapshot:useMemo(()=>current?enrichIntelligenceSnapshot(base,current.patch):base,[base,current]),request,
    pending:(kind:'prices'|'company',id:string)=>Boolean(base.enrichmentDeferred&&!current?.done.includes(`${kind}:${id}`)),
    failed:(id:string)=>Boolean(current?.failed.some(key=>key.endsWith(`:${id}`)))};
}
