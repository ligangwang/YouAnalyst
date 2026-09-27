import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { FUNDAMENTALS_COLLECTION } from './service';
import { akshareSymbol, parseCnAnnual, type CnAnnual } from './cn-annual';
import { maintenanceError, type MaintenanceLog } from '../maintenance-log';
const run=promisify(execFile);
export async function fetchCnAnnual(id:string):Promise<CnAnnual>{
  const {stdout}=await run(process.env.AKSHARE_PYTHON||'python3',[path.resolve('scripts/fetch-cn-annual.py'),akshareSymbol(id)],{timeout:60000,maxBuffer:4*1024*1024,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  return parseCnAnnual(id,JSON.parse(stdout));
}
export async function refreshCnAnnual(options:{db:Firestore;companies:string[];deadline:number;log:MaintenanceLog;dryRun?:boolean;fetch?:(id:string)=>Promise<CnAnnual>;now?:()=>number;print?:(s:string)=>void}){
  const {db,log,dryRun=false}=options,clock=options.now??Date.now;
  const result={updated:0,skipped:0,failed:0,deferred:0};
  const collection=db.collection(FUNDAMENTALS_COLLECTION);
  const entries=await Promise.all(options.companies.map(async id=>({id,stored:(await collection.doc(id).get()).data()??{}})));
  // Resume with the least recently checked company after a deadline/cooldown.
  entries.sort((a,b)=>Number(a.stored.cnAnnualStatus?.checkedAtMs??0)-Number(b.stored.cnAnnualStatus?.checkedAtMs??0));
  for(let i=0;i<entries.length;i++){
    if(clock()+65000>options.deadline||result.failed>=3){result.deferred=entries.length-i;break;}
    const {id,stored}=entries[i],ref=collection.doc(id);
    if(Number(stored.cnAnnualStatus?.retryAfter??0)>clock()){
      // An unresolved provider error must remain visible across Cloud Run retries.
      if(stored.cnAnnualStatus?.outcome==='retry')result.failed++;
      else result.skipped++;
      continue;
    }
    try{
      const annual=await (options.fetch??fetchCnAnnual)(id);
      if(annual.companyId!==id)throw new Error('Annual report company mismatch');
      if(stored.cnAnnual?.end>annual.end||(stored.cnAnnual?.end===annual.end&&stored.cnAnnual?.updated>annual.updated))throw new Error('Provider returned an older annual snapshot');
      if(dryRun)(options.print??console.log)(JSON.stringify({company:id,annual}));
      else await ref.set({market:'CN_A',cnAnnual:annual,cnAnnualStatus:{outcome:'ready',checkedAtMs:clock(),retryAfter:clock()+86400000,lastError:null}},{merge:true});
      result.updated++;
    }catch(error){
      result.failed++;
      // Never clear a previously published report because a provider is unavailable.
      const message=maintenanceError(error).message.slice(0,300);
      log.emit('ERROR','cn_annual_failed',{company:id,error:message});
      if(!dryRun)await ref.set({cnAnnualStatus:{outcome:'retry',checkedAtMs:clock(),retryAfter:clock()+6*3600000,lastError:message}},{merge:true});
    }
  }
  log.emit(result.failed||result.deferred?'WARNING':'INFO','cn_annual_completed',result);
  return result;
}
