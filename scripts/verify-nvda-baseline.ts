import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { parseSecFilingDiscovered, type SecFilingDiscovered } from "../src/lib/sec-filings/event";
import { readSecCollectorCursor, secCollectorMetadata, type SecCollectorCursor } from "../src/lib/sec-filings/store";

const companyId = "NVDA";
const cik = "0001045810";
const project = "ifindata-80905";
function requireValue(ok: unknown): asserts ok {
  if (!ok) throw new Error("NVDA durable-state verification failed; stored data was not printed.");
}
type RecordState = { event: SecFilingDiscovered; state: string; publishedAt: unknown; messageId: unknown };
export type BaselineSnapshot = {
  cursor: SecCollectorCursor | null;
  leaseExpiresAtMs: number;
  pendingDocuments: number;
  records: Record<string, RecordState>;
  pending: Record<string, boolean>;
};
export type ExecutionSummary = { execution: string; startTime: string; completionTime: string };

/** Read existing collections only. Bound the issuer query and never retrieve graph payloads. */
export async function captureNvdaState(db: Firestore): Promise<BaselineSnapshot> {
  const cursor = await readSecCollectorCursor(db, companyId);
  const metadata = await secCollectorMetadata(db).get();
  const pendingDocuments = (await db.collection("sec_filings").where("discoveryPending", "==", true).count().get()).data().count;
  const filings = await db.collection("sec_filings").where("cik", "==", cik)
    .select("discoveryEvents", "discoveryPending", "cik").limit(5001).get();
  requireValue(filings.size <= 5000 && Number.isSafeInteger(pendingDocuments) && pendingDocuments >= 0);
  const records: BaselineSnapshot["records"] = {};
  const pending: BaselineSnapshot["pending"] = {};
  for (const doc of filings.docs) {
    requireValue(doc.get("cik") === cik);
    pending[doc.id] = doc.get("discoveryPending") === true;
    const discoveries = doc.get("discoveryEvents") ?? {};
    requireValue(typeof discoveries === "object" && !Array.isArray(discoveries));
    for (const [id, raw] of Object.entries(discoveries)) {
      const value = raw as RecordState;
      const event = parseSecFilingDiscovered(value?.event);
      requireValue(id === event.eventId && event.accessionNumber === doc.id && event.cik === cik);
      if (event.companyId !== companyId) continue;
      requireValue(["baseline", "pending", "published"].includes(value.state) && !records[id]);
      records[id] = { event, state: value.state, publishedAt: value.publishedAt ?? null, messageId: value.messageId ?? null };
    }
  }
  const leaseExpiresAtMs = Number(metadata.get("leaseExpiresAtMs") ?? 0);
  requireValue(Number.isFinite(leaseExpiresAtMs));
  return { cursor, leaseExpiresAtMs, pendingDocuments, records, pending };
}

export function checkFreshNvdaState(state: BaselineSnapshot, now = Date.now()) {
  requireValue(state.cursor === null && state.leaseExpiresAtMs <= now);
}

export function verifyNvdaState(before: BaselineSnapshot, after: BaselineSnapshot, execution: ExecutionSummary) {
  const start = Date.parse(execution.startTime);
  const end = Date.parse(execution.completionTime);
  requireValue(Number.isFinite(start) && Number.isFinite(end) && start <= end);
  checkFreshNvdaState(before, start);
  const cursor = after.cursor;
  requireValue(cursor?.version === 1 && cursor.cik === cik && cursor.scan === null
    && cursor.lastCompleteAt === cursor.baselineAt && cursor.lastCompleteAt !== null);
  const completed = Date.parse(cursor.lastCompleteAt);
  requireValue(completed >= start - 10_000 && completed <= end + 10_000 && after.leaseExpiresAtMs <= end + 10_000);
  requireValue(after.pendingDocuments === before.pendingDocuments);
  for (const [id, record] of Object.entries(before.records)) {
    requireValue(JSON.stringify(after.records[id]) === JSON.stringify(record));
  }
  for (const [accession, pending] of Object.entries(before.pending)) requireValue(after.pending[accession] === pending);
  let added = 0;
  for (const [id, record] of Object.entries(after.records)) {
    if (before.records[id]) continue;
    requireValue(record.state === "baseline" && record.publishedAt === null && record.messageId === null
      && record.event.companyId === companyId && record.event.cik === cik
      && record.event.discoveredAt === cursor.lastCompleteAt);
    requireValue(after.pending[record.event.accessionNumber] === (before.pending[record.event.accessionNumber] ?? false));
    added += 1;
  }
  requireValue(added <= 2000 && Object.keys(after.records).length > 0);
  return { verified: true, companyId, mode: "baseline-only", execution: execution.execution,
    newBaselineRecords: added, unchangedExistingRecords: Object.keys(before.records).length,
    pendingDocuments: after.pendingDocuments, newPendingOrPublishedRecords: 0,
    publication: "disabled-by-baseline-code", pubsubBacklog: "not-inspected" };
}

async function main() {
  try {
    requireValue(process.env.GCP_PROJECT_ID === project && ["before", "after"].includes(process.argv[2]));
    initializeApp({ credential: applicationDefault(), projectId: project });
    const state = await captureNvdaState(getFirestore());
    if (process.argv[2] === "before") {
      checkFreshNvdaState(state);
      console.log(JSON.stringify(state)); // Redirected to a private temporary file, never a workflow log.
    } else {
      const before = JSON.parse(readFileSync(process.argv[3], "utf8"));
      const execution = JSON.parse(readFileSync(process.argv[4], "utf8"));
      console.log(JSON.stringify(verifyNvdaState(before, state, execution)));
    }
  } catch {
    console.error("NVDA durable-state read or verification failed; do not execute again without inspecting the existing execution. Stored data was not printed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
