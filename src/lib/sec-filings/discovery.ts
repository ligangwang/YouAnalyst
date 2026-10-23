import type {Firestore,DocumentData} from 'firebase-admin/firestore';
import {collectionUniverse,type ThemedCompany} from '../company-themes/model';
import {loadThemeCatalog} from '../company-themes/catalog';
import {catalogThemeIds} from '../company-themes/catalog-model';
import {createSecCompanySync} from '../industry-classification/sec-sync';
import {createMaintenanceLog} from '../maintenance-log';
import {createSecFilingsSource} from './source';
import {collectSecFilings} from './collector';
import {createMapSecObserver} from '../events/sec-disclosures';
import {createSecEarningsObserver} from '../earnings/sec-observer';
import {loadEarningsMap} from '../earnings/map-issuers';
import {earningsCompanies,registerEarningsIssuer} from '../earnings/issuers';
import {publishDiscoveredEarningsOutbox} from '../earnings/live-store';
import {publishEarningsIntake} from './intake-routing';
import {publishJobMessage} from '../job-pubsub';
import {SEC_DOWNLOAD_TOPIC} from './download-worker';
import {SEC_FILINGS_TOPIC} from './event';

// The public ticker directory is shared by successive tasks in this process;
// company submissions and writable checkpoints are always loaded per task.
let tickerDirectory:{agent:string;expires:number;source:ReturnType<typeof createSecFilingsSource>}|undefined;
async function resolveDiscoveryCik(ticker:string,agent:string){
  if(!tickerDirectory||tickerDirectory.agent!==agent||tickerDirectory.expires<=Date.now())tickerDirectory={agent,expires:Date.now()+5*60000,source:createSecFilingsSource(agent,AbortSignal.timeout(60000))};
  const directory=tickerDirectory;
  try{return await directory.source.resolveCik(ticker);}catch(error){if(tickerDirectory===directory)tickerDirectory=undefined;throw error;}
}

/** One issuer snapshot feeds financial filings, disclosures and earnings. Every
 * network request, including archives, still passes through the global SEC gate. */
export async function discoverSecCompany(db:Firestore,ticker:string){
  if(!process.env.SEC_USER_AGENT)throw new Error('SEC_USER_AGENT required');
  const id=`US:${ticker}`,doc=await db.collection('companies').doc(id).get();
  const companies=collectionUniverse({nodes:[],relationships:[],sources:[],asOf:''},doc.exists?[{...doc.data(),id} as ThemedCompany]:[],catalogThemeIds(await loadThemeCatalog(db)));
  if(!companies.nodes.length)return {status:'ineligible',companyId:id};
  const log=createMaintenanceLog('sec-company-discovery'),deadline=Date.now()+8*60000;
  const sync=createSecCompanySync(db,new Map([[id,doc.data()??{}]]));
  const initialStates=new Map<string,DocumentData|undefined>();
  await loadEarningsMap(db,companies,initialStates);
  const byCik=new Map<string,string[]>();
  for(const company of earningsCompanies())if(company.cik)byCik.set(company.cik,[id]);
  const disclosures=createMapSecObserver(db,byCik,{deadline,initialStates});
  const earnings=process.env.EARNINGS_COLLECTION_ENABLED==='1'?createSecEarningsObserver(db,log,{deadline,publish:async discovery=>{
    await publishDiscoveredEarningsOutbox(db,event=>publishEarningsIntake(db,event),[discovery]);
  }}):null;
  const source=createSecFilingsSource(process.env.SEC_USER_AGENT,AbortSignal.timeout(8*60000),async(cik,value,archive)=>{
    try{await sync.observe(cik,value);}catch(error){log.emit('WARNING','sec_company_sync_failed',{cik,error:error instanceof Error?error.message:'Registry synchronization failed'});}
    await disclosures.observe(cik,value,archive);await earnings?.observe(cik,value,archive);
  });
  source.resolveCik=async symbol=>{
    let mapped:string|undefined;
    try{mapped=await resolveDiscoveryCik(symbol,process.env.SEC_USER_AGENT!);}catch(error){if(!(error instanceof Error)||error.message!==`No SEC CIK mapping for ${symbol}`)throw error;}
    const cik=sync.register(id,mapped);registerEarningsIssuer(id,cik);byCik.set(cik,[id]);return cik;
  };
  const result=await collectSecFilings(db,[ticker],log,{source,companyId:ticker,deadline,
    beforeCompany:async()=>{await source.submissions(await source.resolveCik(ticker));},
    publish:event=>publishJobMessage(process.env.SEC_INCREMENTAL_DOWNLOADS_ENABLED==='1'?SEC_DOWNLOAD_TOPIC:SEC_FILINGS_TOPIC,event)});
  if(result.failed||result.partial||result.remaining||disclosures.failed.size||earnings?.failed.size)throw new Error('SEC company discovery incomplete; saved cursors and outboxes retained');
  return {status:'verified',companyId:id,...result};
}
