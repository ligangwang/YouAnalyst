import type {Firestore} from 'firebase-admin/firestore';

export const CAPACITY_CONTROL_DOCUMENT = 'instrument-onboarding-safety';
export const MONITOR_MAX_AGE_MS = 3 * 60_000;

/** A safety deferral is not a provider failure and must not block the request. */
export class OnboardingCapacityDeferred extends Error {}

/** Fail closed if the monitor is absent, stale, paused, or unreadable. */
export async function requireOnboardingCapacity(db:Firestore, now=Date.now()) {
  let data: FirebaseFirestore.DocumentData | undefined;
  try { data=(await db.collection('collectors').doc(CAPACITY_CONTROL_DOCUMENT).get()).data(); }
  catch { throw new OnboardingCapacityDeferred('Capacity monitoring unavailable'); }
  const heartbeat=data?.monitorHeartbeatAt;
  let time=NaN;
  try { if(typeof heartbeat?.toMillis==='function')time=heartbeat.toMillis(); } catch { /* Invalid monitoring data fails closed. */ }
  if (data?.pauseNewBatches!==false || !Number.isFinite(time) || time>now+30_000 || now-time>MONITOR_MAX_AGE_MS)
    throw new OnboardingCapacityDeferred('Capacity monitoring paused or stale');
}
