import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createJobSubscriber } from '../../src/lib/job-pubsub-server';
import { createEarningsAdmission } from '../../src/lib/earnings/live-admission';
import { earningsSourceEvent, parseEarningsJob, parseEarningsDeliveryProbe, EARNINGS_PROBE_SUBSCRIPTION, type EarningsJob } from '../../src/lib/earnings/live-event';

test('earnings probes pass a full source admission queue while provider work stays serial', { timeout: 5000 }, async t => {
  t.mock.method(console, 'info', () => {}); t.mock.method(console, 'error', () => {});
  const admit = createEarningsAdmission();
  let release!: () => void, ready!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const filled = new Promise<void>(resolve => { ready = resolve; });
  let received = 0, active = 0, maximum = 0, sources = 0, probes = 0;
  const server = createJobSubscriber({ project: 'demo', subscription: 'earnings-worker', job: 'fixture', parse: parseEarningsJob,
    additionalSubscriptions: [{ subscription: EARNINGS_PROBE_SUBSCRIPTION, parse: parseEarningsDeliveryProbe }],
    process: (request, _log, signal) => {
      if (request.type === 'earnings.source.discovered' && ++received === 9) ready();
      return admit(request, async () => {
        if (request.type === 'earnings.delivery.probe') { probes++; return { status: 'verified' }; }
        active++; maximum = Math.max(maximum, active); sources++;
        try { await blocked; return { status: 'extracted' }; } finally { active--; }
      }, signal);
    } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { release(); server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (request: EarningsJob, subscription='earnings-worker') => fetch(`${url}/pubsub`, { method: 'POST', body: JSON.stringify({
    subscription: `projects/demo/subscriptions/${subscription}`, message: { data: Buffer.from(JSON.stringify(request)).toString('base64') },
  }) });
  const pending = Array.from({ length: 9 }, (_, i) => post(earningsSourceEvent(`earnings_source_${'a'.repeat(64)}`, i + 1)));
  await filled;
  const excess = await post(earningsSourceEvent(`earnings_source_${'b'.repeat(64)}`, 1));
  assert.equal(excess.status, 503, 'excess source delivery remains unacknowledged');
  const probe = { version: 1, type: 'earnings.delivery.probe', batchId: `earnings_probe_${'a'.repeat(32)}`, createdAt: new Date().toISOString() } as const;
  assert.equal((await post(earningsSourceEvent(`earnings_source_${'c'.repeat(64)}`, 1), EARNINGS_PROBE_SUBSCRIPTION)).status, 503, 'source work cannot enter the control route');
  assert.equal((await post(probe, EARNINGS_PROBE_SUBSCRIPTION)).status, 204);
  assert.equal((await post(probe, EARNINGS_PROBE_SUBSCRIPTION)).status, 204, 'duplicate probe also bypasses source work');
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal(probes, 2); assert.equal(sources, 1); assert.equal(maximum, 1);
  release();
  assert((await Promise.all(pending)).every(response => response.status === 204));
  assert.equal(sources, 9); assert.equal(maximum, 1);
});

test('a disconnected earnings probe cannot run work', async () => {
  const signal = AbortSignal.abort(); let ran = false;
  await assert.rejects(createEarningsAdmission()({ version: 1, type: 'earnings.delivery.probe', batchId: `earnings_probe_${'a'.repeat(32)}`, createdAt: new Date().toISOString() },
    async () => { ran = true; }, signal), /disconnected/);
  assert.equal(ran, false);
});
