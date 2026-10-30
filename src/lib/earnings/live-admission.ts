import { createSerialAdmission } from '../serial-admission';
import type { EarningsJob } from './live-event';

// Keep aligned with deploy-earnings.sh's Cloud Run request concurrency. Rejecting
// an admitted burst at nine requests caused thousands of immediate redeliveries.
export const EARNINGS_HTTP_CONCURRENCY = 80;
export const EARNINGS_ADMISSION_WAIT_MS = 120_000;

/** Hold the admitted HTTP burst in a bounded queue instead of hot-nacking it.
 * Provider work remains serial; provider-free probes bypass the application
 * queue. Two minutes waiting + the existing seven-minute download budget leave
 * a minute of headroom inside the ten-minute HTTP/ack deadline. */
export function createEarningsAdmission() {
  const serial = createSerialAdmission({ maxWaiting: EARNINGS_HTTP_CONCURRENCY - 1, waitMs: EARNINGS_ADMISSION_WAIT_MS });
  return async function admit<T>(request: EarningsJob, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error('Subscriber delivery disconnected; retry');
    return request.type === 'earnings.delivery.probe' ? work() : serial(work, signal);
  };
}
