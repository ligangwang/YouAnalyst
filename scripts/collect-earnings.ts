import { closeLocalCaches } from '../src/lib/local-cache/watch';
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "../src/lib/firebase/firestore";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { parseEarningsCollectorArgs } from "../src/lib/earnings/live-cli";
import { collectLiveEarnings, inspectLiveEarnings } from "../src/lib/earnings/live-collector";
import { createCnEarningsRequester, createCnEarningsSources } from "../src/lib/earnings/live-cn";
import { EARNINGS_TOPIC, type EarningsJob } from "../src/lib/earnings/live-event";
import { createEarningsRequestGate } from "../src/lib/earnings/live-transport";
import { checkEarningsCanary, discoverEarningsCanary, runEarningsCanary, verifyEarningsDelivery } from "../src/lib/earnings/live-verification";
import { ALIBABA_MARCH_REPLAY, replayAlibabaMarch2026 } from "../src/lib/earnings/live-replay";
import {loadEarningsMap} from '../src/lib/earnings/map-issuers';
import {publishEarningsIntake} from '../src/lib/sec-filings/intake-routing';
import {CN_DISCOVERY_TOPIC,cnDiscoveryState,publishCnDiscoveryTasks} from '../src/lib/events/cn-discovery-queue';
import {mapListedCompanies} from '../src/lib/events/disclosures';
import {publishJobMessage} from '../src/lib/job-pubsub';
import {publishEarningsOutbox} from '../src/lib/earnings/live-store';
import {readCollectionCompanies} from '../src/lib/company-support/collection-reader';
import {supportedCompanyUniverse} from '../src/lib/company-support/model';

const log = createMaintenanceLog("collect-earnings");
async function main() {
  const mode = parseEarningsCollectorArgs(process.argv.slice(2));
  if (["collect", "canary", ALIBABA_MARCH_REPLAY].includes(mode) && process.env.EARNINGS_COLLECTION_ENABLED !== "1") {
    log.emit("INFO", "run_completed", { status: "paused", providerRequests: 0, externalWrites: 0 });
    if (mode === "canary") throw new Error("Earnings canary requires explicitly enabled new runtime flags");
    if (mode === ALIBABA_MARCH_REPLAY) throw new Error("Bounded Alibaba replay requires enabled collection");
    return;
  }
  if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
  // Delivery probes need only their receipt; other modes retain issuer setup.
  const graph=mode==='verify-delivery' ? undefined : mode==='collect'&&process.env.CN_DISCOVERY_REQUEST_TOPIC
    ? supportedCompanyUniverse(await readCollectionCompanies(db,[],'CN'))
    : await loadEarningsMap(db);
  if (mode === "dry-run" || mode === "diagnostics") { log.emit("INFO", "run_completed", await inspectLiveEarnings(db)); return; }
  const revision = process.env.GIT_SHA ?? "";
  if (mode === "check-canary") { log.emit("INFO", "run_completed", await checkEarningsCanary(db, revision)); return; }
  if ((process.env.EARNINGS_TOPIC ?? EARNINGS_TOPIC) !== EARNINGS_TOPIC) throw new Error("Unexpected earnings Pub/Sub destination");
  const publish = (event: EarningsJob) => publishEarningsIntake(db,event);
  if (mode === "verify-delivery") { log.emit("INFO", "run_completed", await verifyEarningsDelivery(db, publish, { revision })); return; }
  if (mode === ALIBABA_MARCH_REPLAY) {
    const result = await replayAlibabaMarch2026(db, { revision, collectionEnabled: process.env.EARNINGS_COLLECTION_ENABLED === "1", topic: process.env.EARNINGS_TOPIC ?? EARNINGS_TOPIC, publish });
    log.emit(result.verified ? "INFO" : "WARNING", "run_completed", result);
    if (!result.verified) throw new Error("Bounded Alibaba replay remains unverified; retain its review outcome and provenance");
    return;
  }
  const cnTopic=process.env.CN_DISCOVERY_REQUEST_TOPIC;
  if(cnTopic&&cnTopic!==CN_DISCOVERY_TOPIC)throw new Error('Unexpected A-share discovery destination');
  if(mode==='collect'&&cnTopic){
    if(!graph)throw new Error('Earnings company map is unavailable');
    const result=await publishCnDiscoveryTasks(mapListedCompanies(graph).filter(n=>n.market==='CN_A').map(n=>n.id),'earnings-fallback',task=>publishJobMessage(cnTopic,task),{
      execution:process.env.CLOUD_RUN_EXECUTION??log.runId,deadline:Date.now()+8*60000,earningsEnabled:true,readState:(id,kind)=>cnDiscoveryState(db,id,kind),
    });
    // Repair pending publication independently of individual company discovery.
    const outbox=await publishEarningsOutbox(db,publish,50);
    log.emit(result.failed?'WARNING':'INFO','run_completed',{...result,outbox});
    if(result.failed)throw new Error('A-share discovery publication incomplete; checkpoints retained');
    return;
  }
  if (!process.env.SEC_USER_AGENT?.trim()) throw new Error("SEC_USER_AGENT is required");
  const gate = createEarningsRequestGate(db), requester = createCnEarningsRequester(gate), cn = createCnEarningsSources(requester.request);
  const discoverCn = async (companyId: string, from: string, to: string, firstSeenAt: string) => (await cn.discover({ companyId, from, to, firstSeenAt, maxPages: 20 })).sources;
  if (mode === "canary") {
    const result = await runEarningsCanary(db, { revision, publish, discover: () => discoverEarningsCanary({ userAgent: process.env.SEC_USER_AGENT!, discoverCn }) });
    log.emit("INFO", "run_completed", result); return;
  }
  const result = await collectLiveEarnings(db, log, { discoverCn, publish, deadline: Date.now() + 8 * 60_000,
    discoveryOwnedByMap:process.env.INTELLIGENCE_NEWS_COLLECTOR_ENABLED==='1' });
  log.emit(result.failed || result.deferred ? "WARNING" : "INFO", "run_completed", result);
  if (result.failed) throw new Error("Earnings discovery had incomplete sources; checkpoints retained");
}
main().finally(closeLocalCaches).catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
