import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { publishJobMessage } from "../src/lib/job-pubsub";
import { parseEarningsCollectorArgs } from "../src/lib/earnings/live-cli";
import { collectLiveEarnings, inspectLiveEarnings } from "../src/lib/earnings/live-collector";
import { createCnEarningsRequester, createCnEarningsSources } from "../src/lib/earnings/live-cn";
import { EARNINGS_TOPIC, type EarningsJob } from "../src/lib/earnings/live-event";
import { createEarningsRequestGate } from "../src/lib/earnings/live-transport";
import { checkEarningsCanary, discoverEarningsCanary, runEarningsCanary, verifyEarningsDelivery } from "../src/lib/earnings/live-verification";
import { ALIBABA_MARCH_REPLAY, replayAlibabaMarch2026 } from "../src/lib/earnings/live-replay";
import {loadEarningsMap} from '../src/lib/earnings/map-issuers';

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
  await loadEarningsMap(db);
  if (mode === "dry-run" || mode === "diagnostics") { log.emit("INFO", "run_completed", await inspectLiveEarnings(db)); return; }
  const revision = process.env.GIT_SHA ?? "";
  if (mode === "check-canary") { log.emit("INFO", "run_completed", await checkEarningsCanary(db, revision)); return; }
  if ((process.env.EARNINGS_TOPIC ?? EARNINGS_TOPIC) !== EARNINGS_TOPIC) throw new Error("Unexpected earnings Pub/Sub destination");
  const publish = (event: EarningsJob) => publishJobMessage(EARNINGS_TOPIC, event);
  if (mode === "verify-delivery") { log.emit("INFO", "run_completed", await verifyEarningsDelivery(db, publish, { revision })); return; }
  if (mode === ALIBABA_MARCH_REPLAY) {
    const result = await replayAlibabaMarch2026(db, { revision, collectionEnabled: process.env.EARNINGS_COLLECTION_ENABLED === "1", topic: process.env.EARNINGS_TOPIC ?? EARNINGS_TOPIC, publish });
    log.emit(result.verified ? "INFO" : "WARNING", "run_completed", result);
    if (!result.verified) throw new Error("Bounded Alibaba replay remains unverified; retain its review outcome and provenance");
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
main().catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
