import {Session, type Profiler} from 'node:inspector';
import {performance} from 'node:perf_hooks';

type Delay={startMs:number;endMs:number};
type Sink=(row:Record<string,unknown>)=>void;
declare global {var __startupCpuProfileV1:boolean|undefined;}
const WINDOW_MS=120_000,INTERVAL_US=10_000;
const round=(n:number)=>Math.round(n*100)/100;
function frame(node:Profiler.ProfileNode){
 const f=node.callFrame;
 // Code locations only: never source text, arguments, URLs with query strings,
 // environment values, HTTP headers or document contents.
 const file=f.url.split(/[?#]/)[0].split(/[\\/]/).slice(-2).join('/').slice(-180);
 return {function:f.functionName.slice(0,120),file,line:f.lineNumber+1,column:f.columnNumber+1};
}
export function summarizeStartupProfile(profile:Profiler.Profile,delays:Delay[]){
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),counts=new Map<number,number>();
 let offsetUs=0;
 const samples=(profile.samples??[]).map((id,i)=>{
  offsetUs+=profile.timeDeltas?.[i]??INTERVAL_US;
  counts.set(id,(counts.get(id)??0)+1);
  return {id,ms:offsetUs/1000};
 });
 const top=(hits:Map<number,number>,limit:number)=>[...hits].sort((a,b)=>b[1]-a[1]).slice(0,limit)
  .flatMap(([id,count])=>{const node=nodes.get(id);return node?[{...frame(node),samples:count}]:[];});
 return {profileDurationMs:round((profile.endTime-profile.startTime)/1000),sampleCount:samples.length,
  topFrames:top(counts,20),timerDelays:delays.sort((a,b)=>(b.endMs-b.startMs)-(a.endMs-a.startMs)).slice(0,12).map(delay=>{
   const hits=new Map<number,number>();
   for(const sample of samples)if(sample.ms>=delay.startMs&&sample.ms<=delay.endMs)hits.set(sample.id,(hits.get(sample.id)??0)+1);
   return {startMs:round(delay.startMs),endMs:round(delay.endMs),delayMs:round(delay.endMs-delay.startMs),topFrames:top(hits,8)};
  })};
}

/** One bounded in-process profile per Cloud Run Next server. No inspector port
 * is opened. Sampling stops after startup; timers cannot keep a process alive. */
export async function startStartupProfile(sink:Sink=row=>console.info(JSON.stringify(row))){
 if(globalThis.__startupCpuProfileV1)return;
 globalThis.__startupCpuProfileV1=true;
 const session=new Session();
 const disconnect=()=>{try{session.disconnect();}catch{/* Diagnostic cleanup only. */}};
 try{
  session.connect();
  await new Promise<void>((resolve,reject)=>session.post('Profiler.enable',error=>error?reject(error):resolve()));
  await new Promise<void>((resolve,reject)=>session.post('Profiler.setSamplingInterval',{interval:INTERVAL_US},error=>error?reject(error):resolve()));
  await new Promise<void>((resolve,reject)=>session.post('Profiler.start',error=>error?reject(error):resolve()));
 }catch{
  disconnect();
  try{sink({event:'startup_cpu_profile_unavailable',revision:process.env.K_REVISION});}catch{/* Diagnostic only. */}
  return;
 }
 const startedAt=new Date().toISOString(),start=performance.now(),delays:Delay[]=[];
 try{sink({event:'startup_cpu_profile_started',revision:process.env.K_REVISION,startedAt,windowMs:WINDOW_MS,sampleIntervalUs:INTERVAL_US});}catch{/* Diagnostic only. */}
 let previous=start;
 const timer=setInterval(()=>{
  const now=performance.now(),expected=previous+100;
  if(now-expected>=100){
   delays.push({startMs:expected-start,endMs:now-start});
   if(delays.length>24){delays.sort((a,b)=>(b.endMs-b.startMs)-(a.endMs-a.startMs));delays.length=24;}
  }
  previous=now;
 },100).unref();
 setTimeout(()=>{
  clearInterval(timer);
  try{session.post('Profiler.stop',(error,result)=>{
    try{if(!error)sink({event:'startup_cpu_profile',revision:process.env.K_REVISION,startedAt,
     sampleIntervalUs:INTERVAL_US,windowMs:WINDOW_MS,processWide:true,timerDelayIncludesCpuThrottling:true,
     clockAlignmentApproximate:true,...summarizeStartupProfile(result.profile,delays)});
    }catch{/* Logging must not affect requests. */}finally{disconnect();}
   });
  }catch{disconnect();}
 },WINDOW_MS).unref();
}
