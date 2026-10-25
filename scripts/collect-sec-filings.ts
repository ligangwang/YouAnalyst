import type {ThemedCompany} from '../src/lib/company-themes/model';
import {supportedCompanyUniverse} from '../src/lib/company-support/model';
import {createSecCompanySync} from '../src/lib/industry-classification/sec-sync';
import { closeLocalCaches } from '../src/lib/local-cache/watch';
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData } from "../src/lib/firebase/firestore";
import { loadCollectionCompanies } from "../src/lib/company-themes/service";
import { usFundamentalsTicker } from "../src/lib/fundamentals/identity";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { publishJobMessage } from "../src/lib/job-pubsub";
import { collectSecFilings, inspectSecFilingCollection,repairSecDiscoveryOutbox } from "../src/lib/sec-filings/collector";
import {SEC_DISCOVERY_TOPIC,publishSecDiscoveryTasks,updateSecDiscoveryFreshness,saveSecDiscoveryRotation} from '../src/lib/sec-filings/discovery-queue';
import {secCollectorMetadata} from '../src/lib/sec-filings/store';
import { SEC_FILINGS_TOPIC } from "../src/lib/sec-filings/event";
import { createSecFilingsSource } from "../src/lib/sec-filings/source";
import { baselineSecFilings, inspectSecBaseline } from "../src/lib/sec-filings/baseline";
import { parseSecCollectorArgs } from "../src/lib/sec-filings/cli";
import { createSecEarningsObserver } from "../src/lib/earnings/sec-observer";
import {createMapSecObserver} from '../src/lib/events/sec-disclosures';
import {earningsCompanies,registerEarningsIssuer} from '../src/lib/earnings/issuers';
import {loadEarningsMap} from '../src/lib/earnings/map-issuers';
import {SEC_DOWNLOAD_TOPIC} from '../src/lib/sec-filings/download-worker';
import {publishDiscoveredEarningsOutbox} from '../src/lib/earnings/live-store';
import {publishEarningsIntake} from '../src/lib/sec-filings/intake-routing';

const log = createMaintenanceLog("collect-sec-filings");
async function main() {
  if(!['0','1'].includes(process.env.SEC_INCREMENTAL_DOWNLOADS_ENABLED??'0'))throw new Error('Invalid SEC incremental download flag');
  const { apply, companyId, baselineOnly, maxCompanies } = parseSecCollectorArgs(process.argv.slice(2));
  // Both the scheduler and this explicit application switch start disabled.
  // Running the CLI without --apply is safe even with production credentials.
  if (apply && process.env.SEC_FILINGS_COLLECTOR_ENABLED !== "1") {
    log.emit("INFO", "run_completed", { status: "paused", reason: "SEC_FILINGS_COLLECTOR_ENABLED is not 1" });
    return;
  }
  if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
  // This branch never loads the global graph or reaches the outbox publisher.
  if (baselineOnly && companyId) {
    if (!apply) {
      log.emit("INFO", "run_completed", await inspectSecBaseline(db, companyId));
      return;
    }
    if (!process.env.SEC_USER_AGENT?.trim()) throw new Error("SEC_USER_AGENT is required");
    const timeoutMs = 12 * 60_000;
    const result = await baselineSecFilings(db, companyId, log, {
      source: createSecFilingsSource(process.env.SEC_USER_AGENT, AbortSignal.timeout(timeoutMs)),
      deadline: Date.now() + timeoutMs,
    });
    log.emit(result.status === "partial" ? "WARNING" : "INFO", "run_completed", result);
    if (result.status === "partial") throw new Error("Initial baseline incomplete; retry only the frozen snapshot");
    return;
  }
  const companyDocs = await loadCollectionCompanies(db, 'US');
  const companies = supportedCompanyUniverse(
    companyDocs.map(doc => ({...doc.data(), id: doc.id} as ThemedCompany)));
  const companySync = createSecCompanySync(db, new Map(companyDocs.map(doc => [doc.id, doc.data() ?? {}])));
  const companyIds = companies.nodes.map(company => {
    const ticker = usFundamentalsTicker(company.id);
    if (!ticker) throw new Error(`Invalid US listing identity: ${company.id}`);
    return ticker;
  }).sort();
  if (!apply) {
    log.emit("INFO", "run_completed", { ...await inspectSecFilingCollection(db, companyIds), maxCompaniesPerRun: maxCompanies });
    return;
  }
  const downloadTopic=process.env.SEC_INCREMENTAL_DOWNLOADS_ENABLED==='1'?SEC_DOWNLOAD_TOPIC:SEC_FILINGS_TOPIC;
  if(process.env.SEC_FILINGS_TOPIC&&process.env.SEC_FILINGS_TOPIC!==downloadTopic)throw new Error('Unexpected SEC filing destination for configured download mode');
  const timeoutMs = 12 * 60_000;
  const deadline = Date.now() + timeoutMs;
  if(process.env.SEC_DISCOVERY_REQUEST_TOPIC){
    if(process.env.SEC_DISCOVERY_REQUEST_TOPIC!==SEC_DISCOVERY_TOPIC)throw new Error('Unexpected SEC discovery queue');
    const repair=await repairSecDiscoveryOutbox(db,log,event=>publishJobMessage(downloadTopic,event),deadline);
    if(repair.incomplete)throw new Error('SEC outbox repair incomplete; no new discovery dispatched');
    const ids=companyIds.map(ticker=>`US:${ticker}`);
    const freshness=await updateSecDiscoveryFreshness(db,ids,process.env.EARNINGS_COLLECTION_ENABLED==='1');
    const after=(await secCollectorMetadata(db).get()).get('afterCompanyId');
    const publication=await publishSecDiscoveryTasks(ids,task=>publishJobMessage(SEC_DISCOVERY_TOPIC,task),{
      execution:process.env.CLOUD_RUN_EXECUTION??log.runId,deadline,maxCompanies,after:typeof after==='string'?`US:${after}`:undefined});
    await saveSecDiscoveryRotation(db,publication.afterCompanyId);
    log.emit(publication.failed?'ERROR':'INFO','run_completed',{mode:'pubsub',repair,freshness,...publication});
    if(publication.failed)throw new Error('SEC discovery publication incomplete; retry stable company tasks');
    return;
  }
  if (!process.env.SEC_USER_AGENT?.trim()) throw new Error("SEC_USER_AGENT is required");
  const initialStates = new Map<string, DocumentData | undefined>();
  await loadEarningsMap(db, companies, initialStates);
  const earnings = process.env.EARNINGS_COLLECTION_ENABLED === "1" ? createSecEarningsObserver(db, log, { deadline }) : null;
  const byCik=new Map<string,string[]>();
  for(const company of earningsCompanies())if(company.cik&&companyIds.includes(company.companyId.slice(3)))byCik.set(company.cik,[...(byCik.get(company.cik)??[]),company.companyId]);
  const disclosures=createMapSecObserver(db,byCik,{deadline,initialStates});
  const source = createSecFilingsSource(process.env.SEC_USER_AGENT, AbortSignal.timeout(timeoutMs), async(cik,value,archive)=>{
    try { await companySync.observe(cik, value); }
    catch (error) { log.emit('ERROR', 'sec_company_sync_failed', {cik, error: error instanceof Error ? error.message : String(error)}); }
    await disclosures.observe(cik,value,archive);
    await earnings?.observe(cik,value,archive);
  });
  const resolver=source.resolveCik.bind(source);
  source.resolveCik=async ticker=>{
    let mapped: string | undefined;
    try { mapped = await resolver(ticker); }
    catch (error) { if (!(error instanceof Error) || error.message !== `No SEC CIK mapping for ${ticker}`) throw error; }
    const id=`US:${ticker}`,cik=companySync.register(id,mapped),existing=byCik.get(cik)??[];
    registerEarningsIssuer(id,cik);
    if(!existing.includes(id))byCik.set(cik,[...existing,id]);return cik;
  };
  const result = await collectSecFilings(db, companyIds, log, {
    source,
    // Sidecars share the company's lease even when its financial cursor is not
    // due. This also fences the direct-mode compatibility path during rollout.
    beforeCompany: async ticker => { await source.submissions(await source.resolveCik(ticker)); },
    publish: event => publishJobMessage(downloadTopic, event),
    deadline,
    maxCompanies,
  });
  // Earnings metadata is discovered from these same SEC snapshots. Dispatch its
  // durable tasks now, rather than waiting for a separate discovery run.
  const earningsPublication={published:0,deferred:0};
  for(const discovery of earnings?.discoveries??[]){
    if(!discovery.delivery)continue;
    if(earningsPublication.published>=100||Date.now()+30000>=deadline){earningsPublication.deferred++;continue;}
    earningsPublication.published+=(await publishDiscoveredEarningsOutbox(db,event=>publishEarningsIntake(db,event),[discovery])).published;
  }
  log.emit(result.failed || earnings?.failed.size ? "ERROR" : "INFO", "run_completed", { ...result,
    ...(earnings ? { earningsObserved: earnings.observed.size, earningsFailed: earnings.failed.size,earningsPublication } : {}) });
  if (result.failed) throw new Error("SEC filing collection had failed companies; durable progress retained");
  if (earnings?.failed.size) throw new Error("Earnings SEC discovery was incomplete; existing financial discovery completed independently");
  if(disclosures.failed.size)throw new Error(`Map SEC announcement discovery incomplete for ${[...disclosures.failed].join(', ')}`);
}
main().finally(closeLocalCaches).catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
