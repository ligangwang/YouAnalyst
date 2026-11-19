import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { configuredAnnualStatusStore } from './cn-annual-status';
import { publishCnAnnual, readPublishedFinancials } from '../market-store/runtime';
import { akshareSymbol, parseCnAnnual, type CnAnnual } from './cn-annual';
import { maintenanceError, type MaintenanceLog } from '../maintenance-log';
const run=promisify(execFile);
export async function fetchCnAnnual(id:string):Promise<CnAnnual>{
  const {stdout}=await run(process.env.AKSHARE_PYTHON||'python3',[path.resolve('scripts/fetch-cn-annual.py'),akshareSymbol(id)],{timeout:60000,maxBuffer:4*1024*1024,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  return parseCnAnnual(id,JSON.parse(stdout));
}
export async function refreshCnAnnual(options:{db:Firestore;companies:string[];deadline:number;log:MaintenanceLog;dryRun?:boolean;statusStore?:ReturnType<typeof configuredAnnualStatusStore>;publish?:typeof publishCnAnnual;read?:typeof readPublishedFinancials;fetch?:(id:string)=>Promise<CnAnnual>;now?:()=>number;print?:(s:string)=>void}){
  const {db,log,dryRun=false}=options,clock=options.now??Date.now;
  const result={updated:0,skipped:0,failed:0,deferred:0};
  const statusStore=options.statusStore??configuredAnnualStatusStore();
  const entries=[];
  for(let i=0;i<options.companies.length;i+=16) {
    entries.push(...await Promise.all(options.companies.slice(i,i+16).map(async id=>({id,...await statusStore.read(id)}))));
  }
  // Resume with the least recently checked company after a deadline/cooldown.
  entries.sort((a,b)=>Number(a.status?.checkedAtMs??0)-Number(b.status?.checkedAtMs??0));
  for(let i=0;i<entries.length;i++){
    if(clock()+65000>options.deadline||result.failed>=3){result.deferred=entries.length-i;break;}
    const {id,status,generation}=entries[i];
    if(Number(status?.retryAfter??0)>clock()){
      // An unresolved provider error must remain visible across Cloud Run retries.
      if(status?.outcome==='retry')result.failed++;
      else result.skipped++;
      continue;
    }
    try{
      const annual=await (options.fetch??fetchCnAnnual)(id);
      if(annual.companyId!==id)throw new Error('Annual report company mismatch');
      if(dryRun){
        const stored=await (options.read??readPublishedFinancials)(db,id,['cnAnnual']);
        if(stored?.cnAnnual?.end>annual.end||(stored?.cnAnnual?.end===annual.end&&stored.cnAnnual.updated>annual.updated))
          throw Error('Provider returned an older annual snapshot');
        (options.print??console.log)(JSON.stringify({company:id,annual}));
      } else await (options.publish??publishCnAnnual)(db,annual);
      result.updated++;
    }catch(error){
      result.failed++;
      // Never clear a previously published report because a provider is unavailable.
      const message=maintenanceError(error).message.slice(-300);
      log.emit('ERROR','cn_annual_failed',{company:id,error:message});
      if(!dryRun)await statusStore.write(id,generation,{outcome:'retry',checkedAtMs:clock(),retryAfter:clock()+6*3600000,lastError:message});
      continue;
    }
    if(!dryRun)await statusStore.write(id,generation,{outcome:'ready',checkedAtMs:clock(),retryAfter:clock()+86400000,lastError:null});
  }
  log.emit(result.failed||result.deferred?'WARNING':'INFO','cn_annual_completed',result);
  return result;
}
