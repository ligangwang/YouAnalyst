import type {Firestore,DocumentSnapshot} from 'firebase-admin/firestore';
import {assertReadControl} from './read-control';
export const EVENTS_CONTROL='collectors/_market_parquet_events_control';
export type EventsMode={ready:boolean;cleanupAuthorized:boolean;cleanedCollections:Set<string>};
export function eventsMode(doc:DocumentSnapshot):EventsMode {
 const data=doc.data();
 assertReadControl(data);
 return {ready:data.ready,cleanupAuthorized:data.cleanupAuthorized===true,cleanedCollections:new Set(Array.isArray(data.cleanedCollections)?data.cleanedCollections:[])};
}
/** Independent source-retirement gate: the completed market migration cannot
 * authorize deletion of events before its own production verification. */
export class EventsControl {
 private cached?:{until:number;value:Promise<EventsMode>};
 private stop?:()=>void;
 constructor(private raw:Firestore,onMode?:(ready:boolean)=>void){
  if(onMode)this.stop=raw.doc(EVENTS_CONTROL).onSnapshot(doc=>{try{const mode=eventsMode(doc);this.cached={until:Date.now()+10000,value:Promise.resolve(mode)};onMode(mode.ready);}catch{this.cached=undefined;}},()=>{this.cached=undefined;});
 }
 async read(){
  if(!this.cached||this.cached.until<Date.now()){
   const value=this.raw.doc(EVENTS_CONTROL).get().then(eventsMode);
   this.cached={until:Date.now()+1000,value};
   value.catch(()=>{if(this.cached?.value===value)this.cached=undefined;});
  }
  return this.cached.value;
 }
 close(){this.stop?.();this.cached=undefined;}
}
