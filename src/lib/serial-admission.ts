/** Bound in-flight push deliveries without increasing provider concurrency.
 * Timed-out waiters are removed and never start work after their response fails. */
export function createSerialAdmission(options: { maxWaiting: number; waitMs: number }) {
  if (!Number.isInteger(options.maxWaiting) || options.maxWaiting < 1 || options.maxWaiting > 79
    || !Number.isInteger(options.waitMs) || options.waitMs < 1 || options.waitMs > 120_000) throw new Error('Invalid admission bounds');
  type Waiter = { grant: () => void; timer: ReturnType<typeof setTimeout> };
  const waiting: Waiter[] = [];
  let busy = false;
  async function acquire(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Subscriber delivery disconnected; retry');
    if (!busy) { busy = true; return; }
    if (waiting.length >= options.maxWaiting) throw Object.assign(new Error('Subscriber admission queue full; retry'), { code: 429 });
    await new Promise<void>((resolve, reject) => {
      const remove = () => {
        const index = waiting.indexOf(waiter);
        if (index >= 0) waiting.splice(index, 1);
        clearTimeout(waiter.timer);
        signal?.removeEventListener('abort', disconnected);
      };
      const disconnected = () => { remove(); reject(new Error('Subscriber delivery disconnected; retry')); };
      const waiter: Waiter = { grant: () => { signal?.removeEventListener('abort', disconnected); resolve(); }, timer: setTimeout(() => {
        remove(); reject(Object.assign(new Error('Subscriber admission wait expired; retry'), { code: 429 }));
      }, options.waitMs) };
      waiting.push(waiter);
      signal?.addEventListener('abort', disconnected, { once: true });
      if (signal?.aborted) disconnected();
    });
  }
  function release() {
    const next = waiting.shift();
    if (!next) { busy = false; return; }
    clearTimeout(next.timer); next.grant();
  }
  return async function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await acquire(signal);
    try {
      if (signal?.aborted) throw new Error('Subscriber delivery disconnected; retry');
      return await work();
    } finally { release(); }
  };
}
