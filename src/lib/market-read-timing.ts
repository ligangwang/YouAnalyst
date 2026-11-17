import {randomUUID} from 'node:crypto';

declare global {var __youAnalystMarketReadTimingRun:string|undefined;}
type TimingOptions={now?:()=>number;sink?:(entry:Record<string,unknown>)=>void;enabled?:boolean};
/** Slow website diagnostics only: no query values, object names or document data.
 * Work includes callback/cleanup; file work includes nested DuckDB waits. Do not
 * add overlapping file and DuckDB durations. File acquisition includes cache waits. */
export function startMarketReadTiming(kind:'duckdb'|'files',fileCount?:number,options:TimingOptions={}){
 const enabled=options.enabled??['ifindata-web','market-parquet-ui-probe'].includes(process.env.K_SERVICE??'');
 if(!enabled)return;
 const now=options.now??(()=>performance.now()),start=now();
 const caller=new Error().stack?.split('\n').slice(3,6).map(line=>line.trim()).join(' | ').slice(0,600);
 let workStart:number|undefined,finished=false;
 return {
  workStarted(){workStart??=now();},
  finish(status:'success'|'error'){
   if(finished)return;finished=true;
   const end=now();if(end-start<1000)return;
   try{(options.sink??(entry=>console.info(JSON.stringify(entry))))({
    event:'market_read_timing',kind,waitPhase:kind==='duckdb'?'queue':'file_acquisition',
    waitMs:Math.round((workStart??end)-start),workMs:Math.round(workStart===undefined?0:end-workStart),
    durationMs:Math.round(end-start),workStarted:workStart!==undefined,status,fileCount,caller,
    processRunId:globalThis.__youAnalystMarketReadTimingRun??=randomUUID(),
    revision:process.env.K_REVISION??null,job:process.env.K_SERVICE??null,timestamp:new Date().toISOString(),
   });}catch{/* Timing diagnostics must never change the operation result. */}
  },
 };
}
