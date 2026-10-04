import type {Firestore} from 'firebase-admin/firestore';
import type {KnowledgeGraph} from '../knowledge-graph/model';
import type {CnEarningsJsonRequest} from '../earnings/live-cn';
import {discoverCnEarnings} from '../earnings/discovery';
import {loadEarningsMap} from '../earnings/map-issuers';
import {discoverEarningsSource} from '../earnings/live-store';
import {acquireMaintenanceLease,releaseMaintenanceLease,cloudRunTaskAttempt} from '../maintenance-lease';
import {mapListedCompanies,cnDisclosureRows,type Disclosure} from './disclosures';
import {saveDisclosures,DISCLOSURE_HISTORY_START} from './disclosure-store';

const ORG='https://www.cninfo.com.cn/new/information/topSearch/query';
const ANNOUNCEMENTS='https://www.cninfo.com.cn/new/hisAnnouncement/query';
export function cnMapOrg(companyId:string,payload:unknown){
  if(!/^(?:XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId)||!Array.isArray(payload))throw new Error('Invalid map issuer lookup');
  const matches=payload.filter(row=>row?.code===companyId.split(':')[1]&&row.category==='A股');
  if(matches.length!==1||typeof matches[0].orgId!=='string'||!/^\w{1,40}$/.test(matches[0].orgId))throw new Error('Ambiguous exchange issuer lookup');
  return matches[0].orgId as string;
}
export async function readCnMapDisclosures(companyId:string,from:string,to:string,request:CnEarningsJsonRequest,firstSeenAt:string,onPage?:(page:unknown)=>Promise<void>){
  const post=(url:string,body:Record<string,string>,operation:'cninfo_earnings_org'|'cninfo_earnings_announcements')=>request(url,{method:'POST',body:new URLSearchParams(body).toString(),operation,companyId});
  const orgId=cnMapOrg(companyId,await post(ORG,{keyWord:companyId.split(':')[1],maxNum:'10'},'cninfo_earnings_org'));
  const output:Disclosure[]=[],seen=new Set<string>();let expected:number|undefined;
  for(let pageNum=1;pageNum<=50;pageNum++){
    const page=await post(ANNOUNCEMENTS,{pageNum:String(pageNum),pageSize:'30',column:companyId.startsWith('XSHG:')?'sse':'szse',tabName:'fulltext',plate:'',stock:`${companyId.split(':')[1]},${orgId}`,searchkey:'',secid:'',category:'',trade:'',seDate:`${from}~${to}`,sortName:'',sortType:'',isHLtitle:'true'},'cninfo_earnings_announcements') as {hasMore:boolean;totalAnnouncement:number;announcements:unknown[]};
    const rows=cnDisclosureRows(companyId,orgId,page);
    if(expected!==undefined&&expected!==page.totalAnnouncement)throw new Error('Exchange total changed; checkpoint retained');expected=page.totalAnnouncement;
    if(!rows.length&&page.hasMore)throw new Error('Empty nonterminal exchange page');
    for(const row of rows){if(seen.has(row.id))throw new Error('Overlapping exchange pages');seen.add(row.id);if(row.publication_date!<from||row.publication_date!>to)throw new Error('Exchange document outside requested window');}
    output.push(...rows);await onPage?.(page);
    if(!page.hasMore){if(seen.size!==expected)throw new Error('Incomplete exchange pages');return output;}
    if(pageNum===50)throw new Error('Exchange page budget exhausted; checkpoint retained');
  }
  throw new Error(`Exchange scan incomplete at ${firstSeenAt}`);
}

/** One public disclosure fetch path, also supplying the supported earnings parsers. */
export async function collectCnMapDisclosures(db:Firestore,graph:KnowledgeGraph,request:CnEarningsJsonRequest,options:{deadline:number;runId:string;earningsEnabled:boolean;now?:()=>number}){
  const now=options.now??Date.now,meta=db.collection('collectors').doc('exchange-map'),companies=mapListedCompanies(graph).filter(n=>n.market==='CN_A');
  if(!await acquireMaintenanceLease(meta,options.runId,now(),cloudRunTaskAttempt()))return {status:'busy',companies:companies.length};
  const result={companies:companies.length,completed:0,failed:0,deferred:0,created:0};
  try{
    if(options.earningsEnabled)await loadEarningsMap(db,graph);
    const previous=(await meta.get()).get('afterCompanyId');const next=companies.findIndex(c=>c.id>String(previous??''));const ordered=next<0?companies:[...companies.slice(next),...companies.slice(0,next)];
    for(const company of ordered){
      if(now()+30_000>=options.deadline){result.deferred++;continue;}
      const ref=db.collection('collectors').doc(`exchange-${company.id}`),state=(await ref.get()).data();
      const earningsBaseline=options.earningsEnabled&&state?.earningsCoverageVersion!==2;
      if(!earningsBaseline&&Number(state?.nextPollAtMs)>now())continue;
      const start=now(),at=new Date(start).toISOString(),to=new Date(start+8*3600000).toISOString().slice(0,10),from=!earningsBaseline&&state?.lastCompleteAt?new Date(Date.parse(state.lastCompleteAt)-7*86400000).toISOString().slice(0,10):DISCLOSURE_HISTORY_START;
      try{
        const pendingEarnings:Parameters<typeof discoverEarningsSource>[1][]=[];
        const rows=await readCnMapDisclosures(company.id,from,to,request,at,async page=>{
          if(now()+15_000>=options.deadline)throw new Error('Exchange scan deadline reached');
          if(options.earningsEnabled)pendingEarnings.push(...discoverCnEarnings(company.id,page as Parameters<typeof discoverCnEarnings>[1],at));
        });
        result.created+=await saveDisclosures(db,rows,at,!state?.lastCompleteAt);
        for(const source of pendingEarnings)await discoverEarningsSource(db,source,'document',now());
        await ref.set({companyId:company.id,sourceType:'exchange',status:'complete',lastCompleteAt:at,lastSuccessAt:at,nextPollAtMs:(Math.floor(start/3600000)+1)*3600000,from,to,documents:rows.length,lastError:null,revision:process.env.GIT_SHA??'local',...(options.earningsEnabled?{earningsCoverageVersion:2}:{})},{merge:true});result.completed++;
      }catch(error){result.failed++;await ref.set({companyId:company.id,sourceType:'exchange',status:'partial',lastAttemptAt:at,lastError:error instanceof Error?error.message:'Exchange scan failed'},{merge:true});}
      await meta.set({afterCompanyId:company.id},{merge:true});
    }
    await meta.set({lastRunAt:new Date(now()).toISOString(),result},{merge:true});return result;
  }finally{await releaseMaintenanceLease(meta,options.runId);}
}
