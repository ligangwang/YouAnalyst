/** A push subscription shared by concurrent readers. No request-time polling. */
export class Watch<T> {
  private value?: T;
  private ready = false;
  private stopped = false;
  private unsubscribe?: () => void;
  private retry?: ReturnType<typeof setTimeout>;
  private first!: Promise<T>;
  constructor(private subscribe: (next: (value:T)=>void, error:(error:Error)=>void)=>()=>void) { this.connect(); }
  private connect() {
    this.first = new Promise<T>((resolve,reject)=>{
      this.unsubscribe=this.subscribe(value=>{this.value=value;this.ready=true;resolve(value);},error=>{
        reject(error);
        console.warn('local_cache_listener_failed',error.message);
        if(!this.stopped) {this.retry=setTimeout(()=>this.connect(),5000);this.retry.unref();}
      });
    });
    // A background reconnect can fail without an active reader.
    void this.first.catch(()=>undefined);
  }
  read():Promise<T> {return this.ready?Promise.resolve(this.value!):this.first;}
  close(){this.stopped=true;clearTimeout(this.retry);this.unsubscribe?.();}
}
declare global { var __youAnalystActiveWatchesV1: Set<Watch<unknown>> | undefined; }
const active=globalThis.__youAnalystActiveWatchesV1 ??= new Set<Watch<unknown>>();
export function track<T>(watch:Watch<T>):Watch<T>{active.add(watch as Watch<unknown>);const close=watch.close.bind(watch);watch.close=()=>{close();active.delete(watch as Watch<unknown>);};return watch;}
export function closeLocalCaches(){for(const watch of active)watch.close();active.clear();}
