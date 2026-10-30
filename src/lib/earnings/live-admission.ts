import { createSerialAdmission } from '../serial-admission';
import type { EarningsJob } from './live-event';

/** Nine source deliveries occupy at most nine of the ten HTTP slots.
 * Only one may do provider work; provider-free probes bypass that queue. */
export function createEarningsAdmission() {
  const serial = createSerialAdmission({ maxWaiting: 8, waitMs: 90_000 });
  return async function admit<T>(request: EarningsJob, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error('Subscriber delivery disconnected; retry');
    return request.type === 'earnings.delivery.probe' ? work() : serial(work, signal);
  };
}
