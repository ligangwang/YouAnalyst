import type {Firestore, DocumentReference, DocumentSnapshot} from 'firebase-admin/firestore';
import {setTimeout as delay} from 'node:timers/promises';
import {companyWorkRequest, companyWorkRef, type CompanyWorkRequest} from '../company-work-queue';
import {acquireMaintenanceLease, releaseMaintenanceLease} from '../maintenance-lease';
import {digest} from '../fundamentals/pubsub';
import type {EodCompanyRunRequest} from './eod-company-queue';

export const EOD_BATCH_SIZE = 100;
export type EodBatchRequest = {
  version: 1; type: 'eod.company-batch.requested'; batchId: string;
  parentBatchId: string; requestedAt: string; companyIds: string[]; pass: 0 | 1; offset: number;
};
type Attempt = {pass: 0 | 1; state: 'running' | 'ready' | 'settled'};
type BatchRun = {
  request: EodCompanyRunRequest; companyIds: string[]; batchVersion: 1;
  retryCompanyIds?: string[]; phase: string; dispatchCursor: number;
  completedCompanies: number; completed?: boolean; finalizeCursor?: string | null;
};
type Options = {
  db: Firestore; owner: string;
  publish: (message: EodCompanyRunRequest | EodBatchRequest) => Promise<unknown>;
  plan: () => Promise<string[]>;
  prepare: (ids: string[]) => Promise<Record<string, Record<string, unknown>>>;
  work: (task: CompanyWorkRequest, parent: EodCompanyRunRequest, prepared: Record<string, unknown>, cursor: string | null) => Promise<string | null>;
  finalize: (cursor: string | null) => Promise<string | null>;
  onVerified: (statuses: Record<string, number>) => Promise<void>;
  pause?: (ms: number) => Promise<unknown>;
  budgetMs?: number;
};
const parentRef = (db: Firestore, id: string) => db.collection('eod_runs').doc(`_request_${id}`);
function assertOwner(saved: DocumentSnapshot, owner: string) {
  if (saved.get('leaseOwner') !== owner || Number(saved.get('leaseExpiresAtMs')) <= Date.now()) throw Error('EOD batch lease expired');
}
export function eodBatchRequest(parent: EodCompanyRunRequest, companyIds: string[], pass: 0 | 1, offset: number): EodBatchRequest {
  return {version: 1, type: 'eod.company-batch.requested', parentBatchId: parent.batchId,
    requestedAt: parent.requestedAt, companyIds, pass, offset,
    batchId: digest({parentBatchId: parent.batchId, companyIds, pass, offset})};
}
export function parseEodBatchRequest(value: unknown): EodBatchRequest {
  const v = value as EodBatchRequest;
  if (!v || v.version !== 1 || v.type !== 'eod.company-batch.requested'
    || typeof v.parentBatchId !== 'string' || !/^[\w-]{1,100}$/.test(v.parentBatchId)
    || !Array.isArray(v.companyIds) || !v.companyIds.length || v.companyIds.length > EOD_BATCH_SIZE
    || new Set(v.companyIds).size !== v.companyIds.length || ![0, 1].includes(v.pass)
    || !Number.isSafeInteger(v.offset) || v.offset < 0 || v.offset % EOD_BATCH_SIZE !== 0
    || typeof v.requestedAt !== 'string' || !Number.isFinite(Date.parse(v.requestedAt))) throw Error('Invalid EOD batch request');
  for (const id of v.companyIds) {
    if (typeof id !== 'string' || !/^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(id)) throw Error('Invalid EOD batch company');
  }
  const expected = eodBatchRequest({batchId: v.parentBatchId, requestedAt: v.requestedAt} as EodCompanyRunRequest, v.companyIds, v.pass, v.offset);
  if (v.batchId !== expected.batchId) throw Error('Invalid EOD batch identity');
  return expected;
}

/** Serial batch dispatch bounds aggregate load regardless of duplicate delivery.
 * All continuations are published after lease release. Durable cursors repair a
 * failed publication without re-executing companies that settled this pass. */
export async function processEodBatchedRun(request: EodCompanyRunRequest, options: Options) {
  const {db, owner} = options, ref = parentRef(db, request.batchId), state = db.collection('eod_runs').doc('_company_pipeline');
  if (!await acquireMaintenanceLease(ref, owner)) throw Error('EOD batch run is busy');
  let wake: EodCompanyRunRequest | EodBatchRequest | undefined;
  try {
    let run = (await ref.get()).data() as BatchRun;
    if (!run?.request || digest(run.request) !== digest(request)) throw Error('Unknown EOD batch run');
    if (run.completed) return {batchId: request.batchId, duplicate: true};
    await db.runTransaction(async tx => {
      const pipeline = await tx.get(state), active = pipeline.get('activeRequest');
      if (Number(pipeline.get('leaseExpiresAtMs')) > Date.now()) throw Error('EOD pipeline maintenance is active');
      if (active && active.batchId !== request.batchId) throw Error('Previous company run is unfinished');
      tx.set(state, {activeRequest: request}, {merge: true});
    });
    if (!run.companyIds) {
      const companyIds = [...new Set(await options.plan())].sort();
      if (Buffer.byteLength(JSON.stringify(companyIds)) > 500_000) throw Error('Company manifest exceeds supported size');
      run = {...run, companyIds, batchVersion: 1, phase: 'batch-main', dispatchCursor: 0, completedCompanies: 0};
      await ref.set({companyIds, batchVersion: 1, phase: run.phase, dispatchCursor: 0, completedCompanies: 0}, {merge: true});
    }
    if (run.batchVersion !== 1) throw Error('Cannot adopt an in-flight legacy EOD run');
    if (run.phase === 'batch-main' || run.phase === 'batch-retry') {
      const pass = run.phase === 'batch-main' ? 0 : 1;
      const ids = pass === 0 ? run.companyIds : run.retryCompanyIds!;
      if (run.dispatchCursor < ids.length) {
        wake = eodBatchRequest(request, ids.slice(run.dispatchCursor, run.dispatchCursor + EOD_BATCH_SIZE), pass, run.dispatchCursor);
        return {batchId: request.batchId, phase: run.phase, dispatched: run.dispatchCursor, required: ids.length};
      }
      const failed: string[] = [], statuses: Record<string, number> = {};
      let completed = 0;
      for (let i = 0; i < run.companyIds.length; i += EOD_BATCH_SIZE) {
        const tasks = run.companyIds.slice(i, i + EOD_BATCH_SIZE).map(id => companyWorkRequest('eod', request, id));
        const receipts = await db.getAll(...tasks.map(t => companyWorkRef(db, 'eod_runs', t.batchId)));
        receipts.forEach((receipt, index) => {
          if (!receipt.exists || digest(receipt.get('request')) !== digest(tasks[index])) throw Error('EOD batch receipt barrier is incomplete');
          if (receipt.get('completed') !== true) failed.push(tasks[index].companyId);
          else { completed++; const status = String(receipt.get('status') ?? 'COMPLETED'); statuses[status] = (statuses[status] ?? 0) + 1; }
        });
      }
      if (completed !== run.completedCompanies) throw Error('EOD batch completion counter mismatch');
      if (pass === 0 && failed.length) {
        await ref.set({retryCompanyIds: failed, phase: 'batch-retry', dispatchCursor: 0}, {merge: true});
        wake = request;
        return {batchId: request.batchId, phase: 'batch-retry', failed: failed.length};
      }
      if (failed.length) {
        const error = `${failed.length}/${run.companyIds.length} companies remain incomplete after one retry pass; portfolio finalization withheld`;
        await finishFailed(db, ref, state, request, owner, error);
        return {batchId: request.batchId, phase: 'completed', status: 'FAILED', failed: failed.length};
      }
      await options.onVerified(statuses);
      await ref.set({phase: 'finalizing'}, {merge: true});
      run = {...run, phase: 'finalizing'};
    }
    if (run.phase !== 'finalizing') throw Error('Unknown EOD batch phase');
    const cursor = await options.finalize(run.finalizeCursor ?? null);
    await db.runTransaction(async tx => {
      const saved = await tx.get(ref), pipeline = await tx.get(state);
      assertOwner(saved, owner);
      if (pipeline.get('activeRequest')?.batchId !== request.batchId) throw Error('EOD pipeline ownership changed');
      tx.set(ref, {finalizeCursor: cursor, ...(cursor === null ? {completed: true, phase: 'completed', completedAt: new Date().toISOString()} : {})}, {merge: true});
      if (cursor === null) tx.set(state, {activeRequest: null}, {merge: true});
    });
    if (cursor !== null) wake = request;
    return {batchId: request.batchId, phase: cursor === null ? 'completed' : 'finalizing'};
  } finally {
    await releaseMaintenanceLease(ref, owner);
    if (wake) await options.publish(wake);
  }
}

async function finishFailed(db: Firestore, ref: DocumentReference, state: DocumentReference, request: EodCompanyRunRequest, owner: string, error: string) {
  const dispatch = db.collection('eod_runs').doc(`_dispatch_${digest(request.input)}`);
  await db.runTransaction(async tx => {
    const saved = await tx.get(ref), pipeline = await tx.get(state), scope = await tx.get(dispatch);
    assertOwner(saved, owner);
    if (pipeline.get('activeRequest')?.batchId !== request.batchId) throw Error('EOD pipeline ownership changed');
    const failedAt = new Date().toISOString();
    tx.set(ref, {completed: true, phase: 'completed', status: 'FAILED', error, failedAt}, {merge: true});
    tx.set(db.collection('eod_runs').doc(`${request.input.market}_${request.input.runDate}`), {status: 'FAILED', error, failedAt}, {merge: true});
    tx.set(state, {activeRequest: null}, {merge: true});
    if (scope.get('activeRequest')?.batchId === request.batchId) tx.set(dispatch, {activeRequest: null}, {merge: true});
  });
}

export async function processEodCompanyBatch(message: EodBatchRequest, options: Options) {
  const {db, owner} = options, ref = parentRef(db, message.parentBatchId), state = db.collection('eod_runs').doc('_company_pipeline');
  if (!await acquireMaintenanceLease(ref, owner)) throw Error('EOD batch run is busy');
  let wake: EodBatchRequest | EodCompanyRunRequest | undefined;
  const deadline = Date.now() + (options.budgetMs ?? 240_000);
  try {
    const run = (await ref.get()).data() as BatchRun;
    if (!run?.request || run.batchVersion !== 1) throw Error('Unknown EOD batch run');
    if (run.completed) return {batchId: message.batchId, duplicate: true};
    const expectedPhase = message.pass === 0 ? 'batch-main' : 'batch-retry';
    if (run.phase !== expectedPhase || run.dispatchCursor > message.offset) {
      wake = run.request;
      return {batchId: message.batchId, duplicate: true};
    }
    const ids = message.pass === 0 ? run.companyIds : run.retryCompanyIds!;
    if (run.dispatchCursor !== message.offset || digest(eodBatchRequest(run.request, ids.slice(message.offset, message.offset + EOD_BATCH_SIZE), message.pass, message.offset)) !== digest(message)) throw Error('EOD batch scope mismatch');
    const pipeline = await state.get();
    if (pipeline.get('activeRequest')?.batchId !== run.request.batchId || Number(pipeline.get('leaseExpiresAtMs')) > Date.now()) throw Error('EOD pipeline is not active');
    const tasks = message.companyIds.map(id => companyWorkRequest('eod', run.request, id));
    const receipts = await db.getAll(...tasks.map(t => companyWorkRef(db, 'eod_runs', t.batchId)));
    const prepared = await options.prepare(tasks.filter((_, i) => !receipts[i].exists).map(t => t.companyId));
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i], childRef = companyWorkRef(db, 'eod_runs', task.batchId);
      if (Date.now() >= deadline) { wake = message; return {batchId: message.batchId, continued: true}; }
      await db.runTransaction(async tx => {
        if (!(await tx.get(childRef)).exists) tx.create(childRef, {request: task, result: prepared[task.companyId] ?? {}, completed: false});
      });
      if (!await acquireMaintenanceLease(childRef, owner)) throw Error('EOD company lease is active');
      try {
        let child = await childRef.get();
        if (digest(child.get('request')) !== digest(task)) throw Error('EOD company identity mismatch');
        const attempt = child.get('eodAttempt') as Attempt | undefined;
        if (child.get('completed') === true || (attempt?.pass === message.pass && attempt.state === 'settled')) continue;
        if (attempt && attempt.pass > message.pass) throw Error('EOD attempt pass moved backwards');
        // An interrupted application call has an unknown result. Do not execute
        // it again in this pass; retain its gap for the single cleanup pass.
        if (attempt?.pass === message.pass && attempt.state === 'running') {
          await childRef.set({eodAttempt: {pass: message.pass, state: 'settled'}, status: 'FAILED', error: 'Interrupted EOD attempt; outcome uncertain'}, {merge: true});
          continue;
        }
        let cursor: string | null = child.get('cursor') ?? null;
        while (true) {
          if (Date.now() >= deadline) { wake = message; return {batchId: message.batchId, continued: true}; }
          await childRef.set({eodAttempt: {pass: message.pass, state: 'running'}}, {merge: true});
          let next: string | null;
          try { next = await options.work(task, run.request, child.get('result') ?? {}, cursor); }
          catch {
            // Persist a failed attempt and continue with the other 99 companies.
            // Provider response bodies/tokens are never copied into queue state.
            await childRef.set({eodAttempt: {pass: message.pass, state: 'settled'}, status: 'FAILED', error: 'Company EOD processing remains incomplete'}, {merge: true});
            break;
          }
          if (next !== null && next === cursor) throw Error('EOD prediction cursor did not advance');
          await db.runTransaction(async tx => {
            const saved = await tx.get(childRef), parent = await tx.get(ref);
            assertOwner(saved, owner); assertOwner(parent, owner);
            if (saved.get('completed')) return;
            tx.set(childRef, {cursor: next, eodAttempt: {pass: message.pass, state: next === null ? 'settled' : 'ready'},
              ...(next === null ? {completed: true, completedAt: new Date().toISOString(),
                ...(saved.get('status') === 'NO_DATA' ? {} : {status: 'COMPLETED', error: null})} : {})}, {merge: true});
            if (next === null) tx.set(ref, {completedCompanies: Number(parent.get('completedCompanies') ?? 0) + 1}, {merge: true});
          });
          if (next === null) break;
          cursor = next;
          child = await childRef.get();
        }
        // Retain the established aggregate pacing. Batching is not permission
        // to multiply provider/Firestore load by a hundred.
        await (options.pause ?? delay)(1000);
      } finally { await releaseMaintenanceLease(childRef, owner); }
    }
    await db.runTransaction(async tx => {
      const saved = await tx.get(ref); assertOwner(saved, owner);
      tx.set(ref, {dispatchCursor: message.offset + tasks.length}, {merge: true});
    });
    wake = run.request;
    return {batchId: message.batchId, pass: message.pass, processed: tasks.length};
  } finally {
    await releaseMaintenanceLease(ref, owner);
    if (wake) await options.publish(wake);
  }
}
