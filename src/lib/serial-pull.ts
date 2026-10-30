import {GoogleAuth} from 'google-auth-library';
import {setTimeout as delay} from 'node:timers/promises';

export type PullDelivery = {ackId: string; message: {data: string; messageId?: string}};
export type PullTransport = {
  pull(signal: AbortSignal): Promise<PullDelivery | undefined>;
  deadline(ackId: string, seconds: number): Promise<void>;
  acknowledge(ackId: string): Promise<void>;
};

/** Unary pull intentionally asks for just one message. There is no prefetch or
 * HTTP backlog: the next pull starts only after processing and acknowledgement. */
export function pubsubPullTransport(project: string, subscription: string): PullTransport {
  if (!/^[a-z][a-z0-9-]+$/.test(project) || !/^[A-Za-z][A-Za-z0-9._~-]+$/.test(subscription)) throw Error('Invalid pull subscription');
  const auth = new GoogleAuth({scopes: ['https://www.googleapis.com/auth/pubsub']});
  const base = `https://pubsub.googleapis.com/v1/projects/${project}/subscriptions/${subscription}`;
  async function post<T>(operation: string, data: unknown, signal?: AbortSignal): Promise<T> {
    const client = await auth.getClient();
    return (await client.request<T>({url: `${base}:${operation}`, method: 'POST', data, signal, timeout: 35_000, retry: false})).data;
  }
  return {
    async pull(signal) {
      const result = await post<{receivedMessages?: PullDelivery[]}>('pull', {maxMessages: 1}, signal);
      return result.receivedMessages?.[0];
    },
    async deadline(ackId, seconds) { await post('modifyAckDeadline', {ackIds: [ackId], ackDeadlineSeconds: seconds}); },
    async acknowledge(ackId) { await post('acknowledge', {ackIds: [ackId]}); },
  };
}

export async function runSerialPull(options: {
  transport: PullTransport; signal: AbortSignal;
  process(data: unknown, signal: AbortSignal): Promise<unknown>;
  error(stage: 'pull' | 'process' | 'release', error: unknown): void;
  renewMs?: number;
  pause?: (signal: AbortSignal) => Promise<void>;
}) {
  const {transport, signal} = options;
  const pause = options.pause ?? (async (signal: AbortSignal) => { await delay(1000, undefined, {signal}).catch(() => {}); });
  while (!signal.aborted) {
    let delivery: PullDelivery | undefined;
    try { delivery = await transport.pull(signal); }
    catch (error) { if (!signal.aborted) { options.error('pull', error); await pause(signal); } continue; }
    if (!delivery) { if (!signal.aborted) await pause(signal); continue; }
    const lease = new AbortController();
    const workSignal = AbortSignal.any([signal, lease.signal]);
    let timer: ReturnType<typeof setInterval> | undefined;
    let renewal: Promise<void> | undefined;
    let leaseError: unknown;
    try {
      // Renew before work, then while work is in flight. A failed extension
      // cancels provider work and cannot be mistaken for successful processing.
      workSignal.throwIfAborted();
      await transport.deadline(delivery.ackId, 600);
      timer = setInterval(() => {
        renewal ??= transport.deadline(delivery!.ackId, 600).catch(error => {
          leaseError = error; lease.abort(error);
        }).finally(() => { renewal = undefined; });
      }, options.renewMs ?? 120_000);
      timer.unref();
      const bytes = Buffer.from(delivery.message.data, 'base64');
      if (bytes.length > 64_000) throw Error('Pub/Sub envelope too large');
      await options.process(JSON.parse(bytes.toString('utf8')), workSignal);
      clearInterval(timer);
      await renewal;
      if (leaseError) throw leaseError;
      workSignal.throwIfAborted();
      await transport.acknowledge(delivery.ackId);
    } catch (error) {
      clearInterval(timer);
      await renewal;
      options.error('process', error);
      // Retain normal Pub/Sub retry/dead-letter behavior. Never acknowledge
      // failed, interrupted, malformed, or uncertain work.
      try { await transport.deadline(delivery.ackId, 0); }
      catch (releaseError) { options.error('release', releaseError); }
      if (!signal.aborted) await pause(signal);
    } finally { clearInterval(timer); }
  }
}
