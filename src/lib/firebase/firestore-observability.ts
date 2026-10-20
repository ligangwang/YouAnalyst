import { sourceSnapshot } from '../local-cache/read-scope';
/* eslint-disable @typescript-eslint/no-explicit-any -- Adapter preserves the SDK's overloaded public methods. */
import { timestampWrite } from '../central-cache/write-timestamps';
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

type Kind = 'db' | 'query' | 'doc' | 'aggregate' | 'batch' | 'transaction';
type Shape = { collection: string; clauses: string[] };
type Pending = { operation: string; collection: string; caller: string };
export type FirestoreOperationLog = Record<string, unknown>;
declare global {
  var __youAnalystFirestoreObserverV1: {
    instrumented: WeakMap<object, Firestore>; originals: WeakMap<object, object>; processRunId: string;
  } | undefined;
}
const {instrumented, originals, processRunId} = globalThis.__youAnalystFirestoreObserverV1 ??= {
  instrumented: new WeakMap<object, Firestore>(), originals: new WeakMap<object, object>(), processRunId: randomUUID(),
};
const collectionPath = (path: string = '(unknown)') => path.split('/').map((part, i) => i % 2 ? '*' : part).join('/');
const documentCollection = (path: string = '(unknown)/*') => collectionPath(path.split('/').slice(0, -1).join('/'));
function caller() {
  // Skip Error, caller(), and the SDK proxy invocation even in bundled builds,
  // where the wrapper's filename no longer contains firestore-observability.
  return (new Error().stack?.split('\n').slice(3).find(line =>
    !line.includes('firestore-observability') && !line.includes('node_modules') && !line.includes('node:')) ?? 'unknown')
    .trim().replaceAll('\\', '/').replace(/.*?(?=(?:src|scripts)\/)/, '').slice(0, 300);
}
function unwrap(value: any): any {
  if (Array.isArray(value)) return value.map(unwrap);
  return value && typeof value === 'object' ? originals.get(value) ?? value : value;
}

/** Counts observed SDK operations, not billing. Never performs additional reads. */
export function observeFirestore(db: Firestore, sink: (entry: FirestoreOperationLog) => void = entry => console.info(JSON.stringify(entry))): Firestore {
  if (originals.has(db)) return db;
  const cached = instrumented.get(db);
  if (cached) return cached;
  const metadata = new WeakMap<object, { kind: Kind; shape: Shape }>();
  const emit = (operation: string, shape: Shape, site: string, fields: Record<string, unknown>) => {
    const queryShape = shape.clauses.join(' ');
    try {
      sink({ severity: fields.status === 'error' ? 'WARNING' : 'INFO', event: 'firestore_operation',
        message: `Firestore ${operation}: ${shape.collection}`, schemaVersion: 1,
        queryId: createHash('sha256').update(JSON.stringify([operation, shape, site])).digest('hex').slice(0, 20),
        operation, collection: shape.collection, queryShape, caller: site,
        job: process.env.CLOUD_RUN_JOB ?? process.env.K_SERVICE ?? process.argv[1]?.replaceAll('\\', '/').split('/').at(-1) ?? 'unknown',
        execution: process.env.CLOUD_RUN_EXECUTION, taskIndex: process.env.CLOUD_RUN_TASK_INDEX,
        taskAttempt: process.env.CLOUD_RUN_TASK_ATTEMPT, revision: process.env.K_REVISION ?? process.env.GIT_SHA ?? 'local',
        processRunId, timestamp: new Date().toISOString(), billableReads: null, ...fields });
    } catch { /* Observability must never change application success/failure. */ }
  };
  const writes = (pending: Pending[], fields: Record<string, unknown>) => {
    const groups = new Map<string, { item: Pending; count: number }>();
    for (const item of pending) {
      const key = JSON.stringify(item), group = groups.get(key);
      if (group) group.count++; else groups.set(key, { item, count: 1 });
    }
    for (const { item, count } of groups.values()) emit(item.operation, { collection: item.collection, clauses: [] }, item.caller,
      { documentsWritten: count, ...fields });
  };
  const snapshot = (value: any): any => {
    if (Array.isArray(value)) return value.map(snapshot);
    if (!value || typeof value !== 'object') return value;
    if (!('docs' in value) && !('ref' in value)) return value;
    const proxy = new Proxy(value, { get(target, key) {
      if (key === 'ref') return wrap(target.ref, 'doc', { collection: documentCollection(target.ref.path), clauses: [] });
      if (key === 'docs' && Array.isArray(target.docs)) return target.docs.map(snapshot);
      if (key === 'forEach') return (fn: (doc: any) => void, thisArg?: any) => target.forEach((doc: any) => fn.call(thisArg, snapshot(doc)));
      const member = Reflect.get(target, key, target);
      return typeof member === 'function' ? member.bind(target) : member;
    } });
    originals.set(proxy, value);
    return proxy;
  };
  const wrap = (target: any, kind: Kind, shape: Shape, pending: Pending[] = [], txContext: Record<string, unknown> = {}): any => {
    const proxy = new Proxy(target, { get(object, key) {
      if (key === 'firestore') return observed;
      if (key === 'parent' && object.parent) return wrap(object.parent, kind === 'doc' ? 'query' : 'doc',
        { collection: kind === 'doc' ? collectionPath(object.parent.path) : documentCollection(object.parent.path), clauses: [] });
      const member = Reflect.get(object, key, object);
      if (typeof member !== 'function') return member;
      return (...args: any[]) => {
        const method = String(key), site = caller(), started = Date.now();
        const invoke = (): any => {
          const offset = ['batch','transaction'].includes(kind) ? 1 : 0;
          const path = offset ? args[0]?.path : kind === 'doc' ? object.path : '';
          return Reflect.apply(member, object, timestampWrite(method,path ?? '',args,offset).map(unwrap));
        };
        if (method === 'collection' || method === 'collectionGroup') {
          const result = invoke();
          return wrap(result, 'query', { collection: method === 'collectionGroup' ? `group:${args[0]}` : collectionPath(result.path ?? String(args[0])), clauses: [] });
        }
        if (method === 'doc') {
          const result = invoke();
          return wrap(result, 'doc', { collection: result.path ? documentCollection(result.path) : kind === 'query' ? shape.collection : documentCollection(String(args[0])), clauses: [] });
        }
        if (['where', 'orderBy', 'limit', 'limitToLast', 'offset', 'select', 'startAt', 'startAfter', 'endAt', 'endBefore', 'withConverter', 'count', 'aggregate'].includes(method)) {
          const detail = method === 'where' ? `${String(args[0])} ${typeof args[1] === 'string' ? args[1] : ''} ?`
            : method === 'orderBy' ? `${String(args[0])} ${args[1] ?? 'asc'}`
            : ['limit', 'limitToLast', 'offset'].includes(method) ? String(args[0]) : '';
          return wrap(invoke(), ['count', 'aggregate'].includes(method) ? 'aggregate' : kind,
            { ...shape, clauses: [...shape.clauses, `${method}(${detail})`] });
        }
        if(method==='onSnapshot'){
          const [next,error,...rest]=args;
          let initial=true;
          return Reflect.apply(member,object,[(value:any)=>{
            const changes=typeof value.docChanges==='function'?value.docChanges():[{type:value.exists?'modified':'removed',doc:value}];
            const docs=changes.filter((change:any)=>change.type!=='removed').map((change:any)=>change.doc);
            emit('listen',shape,site,{status:'success',initial,documentsReturned:docs.length,documentsRemoved:changes.length-docs.length,
              changedIds:changes.map((change:any)=>change.doc.id),documentsByCollection:{[shape.collection]:docs.length}});
            initial=false;next(snapshot(value));
          },(failure:any)=>{emit('listen',shape,site,{status:'error',errorCode:failure?.code??'unknown'});error?.(failure);},...rest]);
        }
        if (method === 'batch') return wrap(invoke(), 'batch', shape);
        if (method === 'runTransaction') {
          const transactionId = randomUUID(); let attempt = 0; let finalWrites: Pending[] = [];
          return object.runTransaction(async (tx: any) => {
            attempt++; finalWrites = [];
            return args[0](wrap(tx, 'transaction', shape, finalWrites, { transactionId, transactionAttempt: attempt }));
          }, ...args.slice(1)).then((result: any) => {
            writes(finalWrites, { status: 'success', transactionId, transactionAttempt: attempt, durationMs: Date.now() - started });
            emit('transaction', shape, site, { status: 'success', transactionId, attempts: attempt, durationMs: Date.now() - started });
            return result;
          }, (error: any) => {
            emit('transaction', shape, site, { status: 'error', transactionId, attempts: attempt, errorCode: error?.code ?? 'unknown', documentsWritten: null, durationMs: Date.now() - started });
            throw error;
          });
        }
        if (['set', 'update', 'delete', 'create'].includes(method) && ['batch', 'transaction'].includes(kind)) {
          const result = invoke();
          pending.push({ operation: method, collection: metadata.get(args[0])?.shape.collection ?? documentCollection(args[0]?.path), caller: site });
          return result === object ? proxy : result;
        }
        // Only reads inside an explicit cache scope use source subscriptions.
        // Transactions, aggregates, field-mask reads and writes retain SDK semantics.
        if (method === 'get' && (kind === 'doc' || kind === 'query') && !shape.clauses.some(clause => clause.startsWith('select('))) {
          const cached = sourceSnapshot(db, proxy);
          if (cached) return cached;
        }
        if (method === 'getAll' && kind === 'db' && args.length && args.every(ref => typeof ref.onSnapshot === 'function')) {
          const reads = args.map(ref => sourceSnapshot(db, ref));
          if (reads.every(Boolean)) return Promise.all(reads);
        }
        if (method === 'get' || method === 'getAll' || method === 'commit' || ['set', 'update', 'delete', 'create', 'add'].includes(method)) {
          const reading = method === 'get' || method === 'getAll';
          const subject = kind === 'transaction' && method === 'get' ? metadata.get(args[0]) : undefined;
          const aggregate = kind === 'aggregate' || subject?.kind === 'aggregate';
          const operation = aggregate ? 'aggregate' : method;
          const actualShape = kind === 'transaction' && method === 'get'
            ? subject?.shape ?? { collection: args[0]?.path ? documentCollection(args[0].path) : 'transaction-query', clauses: [] } : shape;
          return Promise.resolve().then(invoke).then((result: any) => {
            const counts: Record<string, unknown> = {};
            if (reading && !aggregate) {
              const docs = Array.isArray(result) ? result : Array.isArray(result?.docs) ? result.docs : [result];
              counts.documentsReturned = docs.filter((doc: any) => doc.exists !== false).length;
              counts.documentsMissing = docs.filter((doc: any) => doc.exists === false).length;
              counts.documentsRequested = Array.isArray(result) || !Array.isArray(result?.docs) ? docs.length : null;
              const collections: Record<string, number> = {};
              for (const doc of docs) if (doc.ref?.path) {
                const collection = documentCollection(doc.ref.path);
                collections[collection] = (collections[collection] ?? 0) + 1;
              }
              counts.documentsByCollection = collections;
            } else if (aggregate) counts.documentsReturned = 0;
            else if (method !== 'commit') counts.documentsWritten = 1;
            if (method === 'commit') writes(pending, { status: 'success', durationMs: Date.now() - started });
            else emit(operation, actualShape, site, { status: 'success', durationMs: Date.now() - started, ...txContext, ...counts });
            if (method === 'add') return wrap(result, 'doc', { ...shape, clauses: [] });
            return reading ? snapshot(result) : result;
          }, (error: any) => {
            emit(operation, actualShape, site, { status: 'error', durationMs: Date.now() - started, ...txContext,
              errorCode: error?.code ?? 'unknown', documentsWritten: reading ? undefined : null });
            throw error;
          });
        }
        return invoke();
      };
    } });
    originals.set(proxy, target);
    metadata.set(proxy, { kind, shape });
    return proxy;
  };
  const observed = wrap(db, 'db', { collection: '(multiple)', clauses: [] }) as Firestore;
  instrumented.set(db, observed);
  return observed;
}
