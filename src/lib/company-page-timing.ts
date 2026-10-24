import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';

type Phase={name:string;offsetMs:number;durationMs:number};
type Trace={start:number;phases:Phase[];closed?:boolean;emit:(row:Record<string,unknown>)=>void};
declare global {var __companyPageTimingV1:AsyncLocalStorage<Trace>|undefined;}
const scope=globalThis.__companyPageTimingV1??=new AsyncLocalStorage<Trace>();
const ms=(value:number)=>Math.round(value*100)/100;
function record(trace:Trace|undefined,name:string,start:number){
 if(trace&&trace.phases.length<24){
  const phase={name,offsetMs:ms(start-trace.start),durationMs:ms(performance.now()-start)};
  trace.phases.push(phase);
  if(trace.closed)try{trace.emit({event:'company_page_phase',...phase});}catch{/* Diagnostic only. */}
 }
}
/** Timings are logs only; no request data, cookies, URL query or document content. */
export async function traceCompanyPage<T>(kind:'page'|'metadata',headers:Pick<Headers,'get'>,work:()=>Promise<T>,sink:(row:Record<string,unknown>)=>void=row=>console.info(JSON.stringify(row))):Promise<T>{
 const id=headers.get('x-ya-company-trace');
 // Only the proxy supplies a fresh bounded timestamp; direct/library readers
 // retain their behavior without logging. Never trust a client-supplied timer.
 const ingress=Number(headers.get('x-ya-company-start')),age=Date.now()-ingress;
 if(!id||!/^[a-f0-9-]{36}$/.test(id)||!Number.isFinite(age)||age<0||age>120000)return work();
 const emit=(row:Record<string,unknown>)=>sink({requestId:id,kind,revision:process.env.K_REVISION,timestamp:new Date().toISOString(),...row});
 const trace:Trace={start:performance.now(),phases:[],emit},cpu=process.cpuUsage();
 try{return await scope.run(trace,work);}finally{
  const duration=performance.now()-trace.start,usage=process.cpuUsage(cpu);
  trace.closed=true;
  try{emit({event:'company_page_timing',processUptimeMs:ms(process.uptime()*1000),
   ingressAt:new Date(ingress).toISOString(),ingressToEntryMs:age,durationMs:ms(duration),cpuMs:ms((usage.user+usage.system)/1000),
   phases:trace.phases,phasesMayOverlap:true,cpuIsProcessWide:true});}catch{/* Diagnostics must never fail a page. */}
 }
}
export async function timeCompanyPhase<T>(name:string,work:()=>Promise<T>):Promise<T>{
 const trace=scope.getStore(),start=performance.now();
 try{return await work();}finally{record(trace,name,start);}
}
export function timeCompanyPhaseSync<T>(name:string,work:()=>T):T{
 const trace=scope.getStore(),start=performance.now();
 try{return work();}finally{record(trace,name,start);}
}
