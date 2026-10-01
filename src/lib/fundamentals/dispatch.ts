import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase/admin";
import { maintenanceError } from "../maintenance-log";
import { FUNDAMENTALS_COLLECTION, needsShareMetadataUpgrade, validFundamentalsTicker } from "./service";
import { digest, publishFundamentalsMessage, type FundamentalsRequest } from "./pubsub";

// Publish after the page response. The existing pending document remains the
// durable fallback if Pub/Sub is unavailable; simultaneous visits publish once.
export async function dispatchRequestedFundamentals(ticker: string, db: Firestore = getAdminFirestore(),
  publish = (message: FundamentalsRequest) => publishFundamentalsMessage(process.env.FUNDAMENTALS_REQUEST_TOPIC || "sec-fundamentals-requests", message)) {
  if (!validFundamentalsTicker(ticker)) return;
  const ref = db.collection(FUNDAMENTALS_COLLECTION).doc(ticker);
  const owner = randomUUID();
  try {
    // Most page views have nothing to publish. Avoid a contended transaction on
    // every visit/poll; the transaction below rechecks before claiming work.
    const current = await ref.get();
    const eligible = (stored: FirebaseFirestore.DocumentData | undefined, now: number) =>
      stored?.pending === true && (!(Number(stored.refreshAfter) > now) || needsShareMetadataUpgrade(stored))
      && !(Number(stored.dispatchAfter) > now);
    if (!eligible(current.data(), current.readTime.toMillis())) return;
    const request = await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref), stored = snapshot.data();
      const now = snapshot.readTime.toMillis();
      if (!eligible(stored, now)) return null;
      const requestedAt = typeof stored?.requestedAt === "string" ? stored.requestedAt : new Date(now).toISOString();
      tx.set(ref, { requestedAt, dispatchOwner: owner, dispatchAfter: now + 300_000 }, { merge: true });
      return { version: 1, type: "fundamentals.refresh.requested", batchId: digest({ ticker, requestedAt }),
        companyIds: [ticker], requestedAt, reason: "scheduled_or_manual" } satisfies FundamentalsRequest;
    });
    if (request) await publish(request);
  } catch (error) {
    console.error(JSON.stringify({severity:"ERROR",message:"fundamentals: dispatch_failed",ticker,error:maintenanceError(error)}));
    // A later visit can retry; the scheduled publisher also retains the pending work.
    await db.runTransaction(async tx => {
      const snapshot=await tx.get(ref);
      if(snapshot.get("dispatchOwner")===owner)tx.set(ref,{dispatchAfter:snapshot.readTime.toMillis()+30_000},{merge:true});
    }).catch(() => undefined);
  }
}
