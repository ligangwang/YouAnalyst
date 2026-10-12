import type {TimelinePrices} from './company-timeline';
const cache=new Map<string,{expires:number;value:Promise<TimelinePrices>}>();
/** Per-instance, bounded cache; short expiry also refreshes historical corrections. */
export function cachedTimelinePrices(key:string,load:()=>Promise<TimelinePrices>,now=Date.now()):Promise<TimelinePrices>{
 const hit=cache.get(key);if(hit&&hit.expires>now)return hit.value;
 cache.delete(key);
 if(cache.size>=64)cache.delete(cache.keys().next().value!);
 const entry={expires:now+60_000,value:Promise.resolve().then(load)};
 cache.set(key,entry);
 entry.value.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
 return entry.value;
}
