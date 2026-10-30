import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialAdmission } from '../../src/lib/serial-admission';

test('admission serializes work and releases its slot after failure', async () => {
  const admit = createSerialAdmission({ maxWaiting: 2, waitMs: 1000 });
  const started: number[] = [];
  let finish!: () => void;
  const first = admit(async () => { started.push(1); await new Promise<void>(resolve => { finish = resolve; }); throw new Error('provider failed'); });
  await new Promise(resolve => setImmediate(resolve));
  const second = admit(async () => { started.push(2); return 'ok'; });
  assert.deepEqual(started, [1]);
  finish();
  await assert.rejects(first, /provider failed/);
  assert.equal(await second, 'ok');
  assert.deepEqual(started, [1, 2]);
});

test('full or expired waiters never execute work', async () => {
  const admit = createSerialAdmission({ maxWaiting: 1, waitMs: 25 });
  let finish!: () => void, ran = false;
  const first = admit(async () => { await new Promise<void>(resolve => { finish = resolve; }); });
  await new Promise(resolve => setImmediate(resolve));
  const second = admit(async () => { ran = true; });
  await assert.rejects(admit(async () => {}), { message: 'Subscriber admission queue full; retry', code: 429 });
  await assert.rejects(second, { message: 'Subscriber admission wait expired; retry', code: 429 });
  finish(); await first;
  assert.equal(ran, false);
  assert.equal(await admit(async () => 42), 42);
});

test('disconnected waiters leave the queue and cannot begin work', async () => {
  const admit = createSerialAdmission({ maxWaiting: 1, waitMs: 1000 });
  let finish!: () => void, ran = false;
  const first = admit(async () => { await new Promise<void>(resolve => { finish = resolve; }); });
  await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController();
  const abandoned = admit(async () => { ran = true; }, controller.signal);
  controller.abort();
  await assert.rejects(abandoned, /disconnected/);
  const next = admit(async () => 42);
  finish(); await first;
  assert.equal(await next, 42);
  assert.equal(ran, false);
});
