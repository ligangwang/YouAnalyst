import {closeEntitySyncs} from './entity-sync';
import {inCacheScope} from './background-scope';
/** A push subscription shared by concurrent readers. No request-time polling. */
export class Watch<T> {
  private value?: T;
  private ready = false;
  private stopped = false;
  private unsubscribe?: () => void;
  private retry?: ReturnType<typeof setTimeout>;
  private first?: Promise<T>;
  private rejectPending?: (error: Error) => void;
  private generation = 0;
  constructor(private subscribe: (next: (value:T)=>void, error:(error:Error)=>void)=>()=>void) { inCacheScope(() => this.connect()); }
  private connect() {
    if(this.stopped)return;
    const generation = ++this.generation;
    let resolveFirst: ((value:T)=>void) | undefined;
    let rejectFirst: ((error:Error)=>void) | undefined;
    this.first = new Promise<T>((resolve,reject)=>{resolveFirst=resolve;rejectFirst=reject;});
    // A background reconnect can fail without an active reader.
    void this.first.catch(()=>undefined);
    this.rejectPending = error => {rejectFirst?.(error);resolveFirst=undefined;rejectFirst=undefined;};
    const fail = (error:Error) => {
      if(this.stopped || generation!==this.generation)return;
      ++this.generation;
      this.unsubscribe?.();this.unsubscribe=undefined;
      this.rejectPending?.(error);this.rejectPending=undefined;
      console.warn('local_cache_listener_failed',error.message);
      this.retry=setTimeout(()=>this.connect(),5000);this.retry.unref();
    };
    try {
      const unsubscribe=this.subscribe(value=>{
        if(this.stopped || generation!==this.generation)return;
        this.value=value;this.ready=true;
        resolveFirst?.(value);
        // Neither the Watch nor its live callback may retain the settled promise
        // (and therefore the first snapshot) after a newer value arrives.
        resolveFirst=undefined;rejectFirst=undefined;
        this.rejectPending=undefined;this.first=undefined;
      },fail);
      if(generation===this.generation && !this.stopped)this.unsubscribe=unsubscribe;
      else unsubscribe();
    } catch(error) {fail(error instanceof Error?error:new Error(String(error)));}
  }
  read():Promise<T> {return this.stopped?Promise.reject(Error('Cache listener closed')):this.ready?Promise.resolve(this.value!):this.first!;}
  close(){
    if(this.stopped)return;
    this.stopped=true;++this.generation;clearTimeout(this.retry);
    this.unsubscribe?.();this.unsubscribe=undefined;
    this.rejectPending?.(Error('Cache listener closed'));this.rejectPending=undefined;
    this.first=undefined;this.value=undefined;this.ready=false;
  }
}
declare global { var __youAnalystActiveWatchesV1: Set<Watch<unknown>> | undefined; }
const active=globalThis.__youAnalystActiveWatchesV1 ??= new Set<Watch<unknown>>();
export function track<T>(watch:Watch<T>):Watch<T>{active.add(watch as Watch<unknown>);const close=watch.close.bind(watch);watch.close=()=>{close();active.delete(watch as Watch<unknown>);};return watch;}
export function closeLocalCaches(){closeEntitySyncs();for(const watch of active)watch.close();active.clear();}
