import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Firestore } from "firebase-admin/firestore";
import { createSecFilingsSource } from "../sec-filings/source";
import { classifyEarningsTitle, discoverSecEarnings } from "./discovery";
import { earningsSourceEvent, type EarningsJob, type EarningsDeliveryProbe } from "./live-event";
import { discoverEarningsSource, earningsMetadata, EARNINGS_RECORDS, EARNINGS_SOURCES, publishEarningsOutbox, readEarningsCapture, type EarningsWork } from "./live-store";
import type { EarningsDiscovery } from "./live-collector";
import { earningsScanWindow } from "./sec-observer";
import { type EarningsRecord, type EarningsSource, validTimestamp } from "./model";

type Clock = { now?: () => number; sleep?: (ms: number) => Promise<void>; revision: string };
function requireRevision(revision: string) { if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A deployed exact GIT_SHA is required for earnings verification"); }
export async function verifyEarningsDelivery(db: Firestore, publish: (event: EarningsJob) => Promise<string>, options: Clock) {
  requireRevision(options.revision);
  const now = options.now ?? Date.now, sleep = options.sleep ?? (ms => delay(ms));
  const createdAt = new Date(now()).toISOString(), probe: EarningsDeliveryProbe = { version: 1, type: "earnings.delivery.probe", batchId: `earnings_probe_${randomBytes(16).toString("hex")}`, createdAt };
  const ref = earningsMetadata(db, probe.batchId);
  await earningsMetadata(db, "last_probe").set({ verified: false, revision: options.revision, createdAt, probeId: probe.batchId });
  await ref.set({ type: probe.type, createdAt, expiresAtMs: now() + 10 * 60_000, deliveries: 0 });
  for (let attempt = 0; attempt < 2; attempt++) if (!await publish(probe)) throw new Error("Earnings probe publish unconfirmed");
  const deadline = now() + 4 * 60_000;
  while (now() < deadline) {
    const receipt = (await ref.get()).data();
    if (receipt?.firstDeliveries === 1 && Number(receipt.duplicateDeliveries) >= 1 && receipt.subscriberRevision === options.revision) {
      const result = { verified: true, revision: options.revision, probeId: probe.batchId, completedAt: new Date(now()).toISOString(), firstDeliveries: 1,
        duplicateDeliveries: Number(receipt.duplicateDeliveries), providerRequests: 0, earningsRecords: 0 };
      await earningsMetadata(db, "last_probe").set(result); return result;
    }
    await sleep(5000);
  }
  throw new Error("Earnings provider-free delivery verification timed out");
}
export function selectAmdCanarySource(value: unknown, now = Date.now()) {
  const payload = value as Parameters<typeof discoverSecEarnings>[1];
  const recent = payload?.filings?.recent;
  if (!Array.isArray(recent?.items) || !Array.isArray(recent.accessionNumber) || recent.items.length !== recent.accessionNumber.length) throw new Error("AMD canary requires explicit SEC Item 2.02 metadata");
  const items = recent.items;
  const accessions = new Set(recent.accessionNumber.filter((_entry, index) => typeof items[index] === "string" && /\b2\.02\b/.test(String(items[index]))));
  const window = earningsScanWindow(undefined, now);
  const candidate = discoverSecEarnings("US:AMD", payload, new Date(now).toISOString()).filter(source => source.form === "8-K" && accessions.has(source.accession)
    && source.filingDate! >= window.from && source.filingDate! <= window.to).sort((a, b) => b.filingDate!.localeCompare(a.filingDate!) || (Date.parse(b.filingAcceptedAt ?? "") || 0) - (Date.parse(a.filingAcceptedAt ?? "") || 0))[0];
  if (!candidate) throw new Error("No bounded AMD Item 2.02 earnings filing available");
  return candidate;
}
export async function discoverEarningsCanary(options: { userAgent: string; discoverCn: EarningsDiscovery; now?: () => number }) {
  const now = options.now ?? Date.now;
  let observed: unknown;
  const source = createSecFilingsSource(options.userAgent, AbortSignal.timeout(60_000), async (_cik, value) => { observed = value; });
  await source.submissions("0000002488");
  const amd = selectAmdCanarySource(observed, now()), window = earningsScanWindow(undefined, now(), 8);
  const rows = await options.discoverCn("XSHE:301308", window.from, window.to, new Date(now()).toISOString());
  const longsys = rows.filter(row => row.companyId === "XSHE:301308" && classifyEarningsTitle(row.title) === "actual"
    && /(?:第?一季度|半年度)报告/.test(row.title) && !/摘要|更正|修订|英文/.test(row.title) && row.publishedAt?.value)
    .sort((a, b) => b.publishedAt!.value.localeCompare(a.publishedAt!.value))[0];
  if (!longsys) throw new Error("No supported full Longsys report available for canary");
  return [amd, longsys];
}
type CanaryResult = { companyId: string; revisionId: string; sourceId: string; sourceUrl: string; rawSha256: string; period: EarningsRecord["period"]; revenue: number | null };
export async function runEarningsCanary(db: Firestore, options: Clock & {
  discover: () => Promise<EarningsSource[]>; publish: (event: EarningsJob) => Promise<string>;
}) {
  requireRevision(options.revision);
  const now = options.now ?? Date.now, sleep = options.sleep ?? (ms => delay(ms)), marker = earningsMetadata(db, "last_canary");
  const startedAt = new Date(now()).toISOString();
  // Invalidate an earlier success before even starting source discovery.
  const expiresAtMs = now() + 12 * 60_000;
  await marker.set({ verified: false, revision: options.revision, startedAt, expiresAtMs, allowedDeliveries: [] });
  try {
    const sources = await options.discover();
    if (sources.length !== 2 || sources[0].companyId !== "US:AMD" || sources[0].form !== "8-K" || sources[1].companyId !== "XSHE:301308") throw new Error("Canary cohort must be exactly AMD and Longsys");
    const ids: string[] = [];
    ids.push((await discoverEarningsSource(db, sources[0], "sec_filing", now(), { force: true, maxExhibits: 5, requireCanaryBounds: true })).sourceId);
    ids.push((await discoverEarningsSource(db, sources[1], "document", now(), { force: true })).sourceId);
    const initial = await Promise.all(ids.map(id => db.collection(EARNINGS_SOURCES).doc(id).get()));
    const allowedDeliveries = initial.map(row => earningsSourceEvent(row.id, Number(row.get("generation"))));
    await marker.set({ sourceIds: ids, allowedDeliveries }, { merge: true });
    await publishEarningsOutbox(db, options.publish, 2, ids);
    const deadline = now() + 8 * 60_000;
    while (now() < deadline) {
      const parents = await Promise.all(ids.map(id => db.collection(EARNINGS_SOURCES).doc(id).get()));
      const intake = parents.map(doc => doc.data() as EarningsWork & { processedRevision?: string });
      if (intake.some(row => ["review_required", "skipped"].includes(row.status))) throw new Error("Live canary source requires review; keep collection paused");
      if (intake[0].status === "expanded" && intake[0].captureId && intake[1].status === "extracted") {
        const children = await db.collection(EARNINGS_SOURCES).where("parentCaptureId", "==", intake[0].captureId).limit(6).get();
        if (children.size > 5) throw new Error("Canary exhibit budget exceeded");
        const extracted = children.docs.map(doc => doc.data() as EarningsWork & { processedRevision?: string }).filter(row => row.status === "extracted");
        const ready = [extracted.find(row => row.source.companyId === "US:AMD"), intake[1]];
        if (ready.every(row => row?.revisionId && row.captureId && row.processedRevision === options.revision)) {
          const records: CanaryResult[] = [];
          for (const row of ready as Array<EarningsWork & { processedRevision: string }>) {
            const saved = (await db.collection(EARNINGS_RECORDS).doc(row.revisionId!).get()).get("record") as EarningsRecord | undefined;
            if (!saved || saved.kind !== "actual" || saved.companyId !== row.source.companyId || saved.sourceId !== row.sourceId) throw new Error("Canary normalized record mismatch");
            const restored = await readEarningsCapture(db, row.captureId!);
            if (saved.rawSha256 !== restored.document.rawSha256 || saved.textSha256 !== restored.document.textSha256) throw new Error("Canary stored provenance mismatch");
            const revenue = saved.metrics.find(metric => metric.name === "revenue" && metric.scope === "consolidated" && metric.kind === "actual");
            if (!revenue || !Number.isFinite(revenue.value)) throw new Error("Canary consolidated actual revenue missing");
            records.push({ companyId: saved.companyId, revisionId: saved.revisionId, sourceId: saved.sourceId, sourceUrl: saved.source.url,
              rawSha256: saved.rawSha256, period: saved.period, revenue: revenue.value });
          }
          const result = { verified: true, revision: options.revision, startedAt, expiresAtMs, allowedDeliveries, completedAt: new Date(now()).toISOString(), sourceIds: ids, records };
          await marker.set(result); return result;
        }
        if (children.size && children.docs.every(doc => ["review_required", "skipped"].includes(doc.get("status")))) throw new Error("AMD canary exhibits require review");
      }
      await sleep(5000);
    }
    throw new Error("Live earnings canary timed out; keep collection paused");
  } catch (error) {
    await marker.set({ verified: false, failedAt: new Date(now()).toISOString(), reason: (error instanceof Error ? error.message : "Canary failed").slice(0, 1000) }, { merge: true });
    throw error;
  }
}
export async function checkEarningsCanary(db: Firestore, revision: string, now = Date.now()) {
  requireRevision(revision);
  const marker = (await earningsMetadata(db, "last_canary").get()).data();
  if (marker?.verified !== true || marker.revision !== revision || !validTimestamp(marker.completedAt)
    || Date.parse(marker.completedAt) > now + 60_000 || now - Date.parse(marker.completedAt) > 24 * 60 * 60_000
    || !Array.isArray(marker.records) || marker.records.length !== 2
    || marker.records.map(row => row.companyId).sort().join(",") !== "US:AMD,XSHE:301308") throw new Error("Current revision has no fresh verified AMD/Longsys canary");
  for (const row of marker.records as CanaryResult[]) {
    const saved = (await db.collection(EARNINGS_RECORDS).doc(row.revisionId).get()).data();
    if (saved?.record?.companyId !== row.companyId || saved.record.rawSha256 !== row.rawSha256 || saved.record.kind !== "actual") throw new Error("Canary normalized proof is missing");
    const restored = await readEarningsCapture(db, saved.captureId);
    if (restored.document.rawSha256 !== row.rawSha256) throw new Error("Canary raw proof is missing");
  }
  return { verified: true, revision, completedAt: marker.completedAt, companies: ["US:AMD", "XSHE:301308"], providerRequests: 0 };
}
