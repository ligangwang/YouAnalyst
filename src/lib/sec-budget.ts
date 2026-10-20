import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "./firebase/admin";
import { SEC_COLLECTOR_STATE_COLLECTION } from "./sec-collector-state";

export const SEC_REQUESTS_PER_SECOND = 5;
const SPACING_MS = 1000 / SEC_REQUESTS_PER_SECOND;
const LEASE_MS = 30_000; // Longer than the transport's 12-second abort deadline.

export function secCooldownMs(status: number, retryAfter: string | null, now = Date.now()) {
  if (status !== 403 && status !== 429) return 0;
  const supplied = retryAfter === null ? 0 : /^\d+(\.\d+)?$/.test(retryAfter)
    ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
  return Math.max(status === 403 ? 600_000 : 60_000, Number.isFinite(supplied) ? supplied : 0);
}

// A single shared gate serializes outbound requests across all application replicas
// and jobs. Spacing starts after completion, so slow requests reduce throughput;
// delayed processes cannot spend old reservations together in a burst.
export function createSecBudget(db: Firestore, sleep: (ms: number, signal: AbortSignal) => Promise<void> = (ms, signal) => delay(ms, undefined, { signal })) {
  const ref = db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc("_sec_request_budget");
  const legacyRef = db.collection("company_fundamentals").doc("_sec_request_budget");
  return {
    async run<T>(signal: AbortSignal, work: (cooldown: (ms: number) => void) => Promise<T>): Promise<T> {
      const owner = randomUUID();
      let cooldownMs = 0;
      let bridge = false;
      let contentionWaitMs = 250;
      for (;;) {
        signal.throwIfAborted();
        const wait = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          const now = snap.readTime.toMillis(); // Shared server clock, not replica clocks.
          bridge = snap.get("bridgeRetired") !== true;
          // During rollout, old workers still own the legacy gate. Mirror its
          // acquisition atomically so both generations serialize on one lock.
          const stored = bridge ? (await tx.get(legacyRef)).data() : snap.data();
          if (Number(stored?.cooldownUntil) > now) {
            throw Object.assign(new Error("SEC shared cooldown is active"), { code: 429 });
          }
          const remaining = Math.max(Number(stored?.leaseUntil) || 0, Number(stored?.nextAllowedAt) || 0) - now;
          if (remaining > 0) return Math.min(remaining, contentionWaitMs);
          signal.throwIfAborted();
          tx.set(ref, { owner, leaseUntil: now + LEASE_MS }, { merge: true });
          if (bridge) tx.set(legacyRef, { owner, leaseUntil: now + LEASE_MS }, { merge: true });
          return 0;
        });
        if (wait > 0) {
          await sleep(wait, signal);
          // A held 30-second lease used to be polled four times a second.
          // Back off under contention, but always recheck the shared lock and
          // cooldown before sending. Normal 200ms spacing remains exact.
          contentionWaitMs=Math.min(1000,contentionWaitMs*2);
          continue;
        }
        break;
      }
      try {
        signal.throwIfAborted();
        return await work(ms => { cooldownMs = Math.max(cooldownMs, ms); });
      } finally {
        // Do not use the caller's aborted signal: the gate still needs releasing.
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          const legacy = bridge ? await tx.get(legacyRef) : undefined;
          if (snap.get("owner") !== owner) return;
          const now = snap.readTime.toMillis();
          tx.set(ref, { owner: null, leaseUntil: 0, nextAllowedAt: now + SPACING_MS,
            cooldownUntil: Math.max(Number(snap.get("cooldownUntil")) || 0, now + cooldownMs) }, { merge: true });
          if (legacy?.get("owner") === owner) tx.set(legacyRef, { owner: null, leaseUntil: 0, nextAllowedAt: now + SPACING_MS,
            cooldownUntil: Math.max(Number(legacy.get("cooldownUntil")) || 0, now + cooldownMs) }, { merge: true });
        });
      }
    },
  };
}

export const secBudget = {
  run<T>(signal: AbortSignal, work: (cooldown: (ms: number) => void) => Promise<T>) {
    return createSecBudget(getAdminFirestore()).run(signal, work);
  },
};
