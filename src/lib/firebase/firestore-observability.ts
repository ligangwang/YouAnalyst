import { collectionSourceSnapshot } from '../local-cache/read-scope';
import { isSnapshotCollection, companySourceSnapshot, companyDirectoryEnabled, registerCompanySource, refreshCompanyDirectoryIds } from '../local-cache/company-directory';
/* eslint-disable @typescript-eslint/no-explicit-any -- Adapter preserves the SDK's overloaded public methods. */
import { timestampWrite } from '../central-cache/write-timestamps';
import { isEntityPath, lifecycleFields } from '../entity-snapshots/lifecycle';
import { FieldValue, FieldPath } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

type Kind = 'db' | 'query' | 'doc' | 'aggregate' | 'batch' | 'transaction';
type Shape = { collection: string; clauses: string[]; steps?:{method:string;args:unknown[]}[] };
type Pending = { operation: string; collection: string; caller: string };
type Deferred = { method:string; args:any[]; site:string };
type EntityTransaction = { reads:Map<string,any>; writes:Deferred[] };
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

/** Counts SDK operations, not billing. Entity mutations additionally read their
 * transaction state to preserve soft-delete timestamps under concurrent writes. */
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
        queryId: createHash('sha256').update(JSON.stringify([operation, {collection:shape.collection,clauses:shape.clauses}, site])).digest('hex').slice(0, 20),
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
  const wrap = (target: any, kind: Kind, shape: Shape, pending: Pending[] = [], txContext: Record<string, unknown> = {}, entityTx?:EntityTransaction): any => {
    const proxy = new Proxy(target, { get(object, key) {
      if (key === 'firestore') return observed;
      if (key === 'parent' && object.parent) return wrap(object.parent, kind === 'doc' ? 'query' : 'doc',
        { collection: kind === 'doc' ? collectionPath(object.parent.path) : documentCollection(object.parent.path), clauses: [] });
      const member = Reflect.get(object, key, object);
      if (typeof member !== 'function') return member;
      return (...args: any[]) => {
        const method = String(key);
        // Cache equality checks are local comparisons, not SDK operations. Avoid
        // collecting a stack trace for every candidate in the bounded cache.
        if (method === 'isEqual') return Reflect.apply(member, object, args.map(unwrap));
        const site = caller(), started = Date.now();
        if(method==='add'&&kind==='query'&&isEntityPath(`${object.path}/generated`)){
          const ref=proxy.doc();return ref.create(args[0]).then(()=>ref);
        }
        if(method==='recursiveDelete'&&(isEntityPath(args[0]?.path??'')||isEntityPath(`${args[0]?.path}/generated`)))throw Error('Use soft deletion for entity collections');
        const mutating=['set','update','delete','create'].includes(method);
        const entityPath=kind==='doc'?object.path:args[0]?.path;
        if(mutating&&kind==='batch'&&isEntityPath(entityPath??''))throw Error('Entity writes require a transaction; use runTransaction or mutateEntity');
        if(mutating&&kind==='transaction'&&entityTx){
          entityTx.writes.push({method,args:args.map(unwrap),site});
          return proxy;
        }
        if(mutating&&kind==='doc'&&isEntityPath(entityPath??'')){
          // Direct entity mutations use the same transactional lifecycle rules.
          return observed.runTransaction(async tx=>{
            if(method!=='create')await tx.get(proxy);
            (tx[method as keyof typeof tx] as any).call(tx,proxy,...args);
          });
        }
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
          let result;
          if(isSnapshotCollection(shape.collection)&&companyDirectoryEnabled(observed)&&['startAt','startAfter','endAt','endBefore'].includes(method)&&args[0]?.get&&args[0]?.ref){
            const orders=(shape.steps??[]).filter(s=>s.method==='orderBy');
            let query=object;
            if(!orders.some(s=>s.args[0] instanceof FieldPath&&(s.args[0] as FieldPath).isEqual(FieldPath.documentId()))){
              const direction=orders.at(-1)?.args[1]??'asc';query=query.orderBy(FieldPath.documentId(),direction);orders.push({method:'orderBy',args:[FieldPath.documentId(),direction]});
            }
            result=query[method](...orders.map(s=>s.args[0] instanceof FieldPath&&(s.args[0] as FieldPath).isEqual(FieldPath.documentId())?args[0].id:args[0].get(s.args[0])));
          }else result=invoke();
          const detail = method === 'where' ? `${String(args[0])} ${typeof args[1] === 'string' ? args[1] : ''} ?`
            : method === 'orderBy' ? `${String(args[0])} ${args[1] ?? 'asc'}`
            : ['limit', 'limitToLast', 'offset'].includes(method) ? String(args[0]) : '';
          return wrap(result, ['count', 'aggregate'].includes(method) ? 'aggregate' : kind,
            { ...shape, clauses: [...shape.clauses, `${method}(${detail})`], steps:[...(shape.steps??[]),{method,args}] });
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
          const transactionId = randomUUID(); let attempt = 0; let finalWrites: Pending[] = [];let changedCompanies:{collection:string;id:string}[]=[];
          return object.runTransaction(async (tx: any) => {
            attempt++; finalWrites = [];changedCompanies=[];
            const state:EntityTransaction={reads:new Map(),writes:[]};
            const wrapped=wrap(tx,'transaction',shape,finalWrites,{transactionId,transactionAttempt:attempt},state);
            const result=await args[0](wrapped);
            const refs=new Map<string,any>();
            for(const write of state.writes)if(isEntityPath(write.args[0]?.path??'')&&write.method!=='create')refs.set(write.args[0].path,write.args[0]);
            for(const [path,ref] of refs)if(!state.reads.has(path))await wrapped.get(ref);
            const mutated=new Set<string>();
            for(const write of state.writes){
              let {method}=write;let values=write.args;
              const ref=values[0],path=ref?.path??'';
              if(isEntityPath(path)){
                if(mutated.has(path))throw Error('Combine entity changes into one write per transaction');
                mutated.add(path);
                const previous=state.reads.get(path)?.data();
                if(method==='delete'){
                  if(!previous||previous.isDeleted===true)continue;
                  method='update';values=[ref,{isDeleted:true,deletedAt:FieldValue.delete()},...values.slice(1)];
                }else {
                  const data=values[1];
                  if(data&&Object.getPrototypeOf(data)===Object.prototype){
                    let options=method==='set'?values[2]:undefined;
                    if(method==='set'&&previous&&(previous.isDeleted===true||data.isDeleted===true)&&data.isDeleted!==false&&!options?.mergeFields){
                      options={merge:true};values=[...values.slice(0,2),options];
                    }
                    const replacing=method==='create'||method==='set'&&!options?.merge&&!options?.mergeFields;
                    const patch={...data};delete patch.deletedAt;
                    const requested=options?.mergeFields&&!options.mergeFields.some((f:any)=>String(f)==='isDeleted')?undefined:patch.isDeleted;
                    const fields=lifecycleFields(previous,requested,replacing);
                    values=[ref,{...patch,...fields},...values.slice(2)];
                    if(options?.mergeFields)values[2]={...options,mergeFields:[...options.mergeFields.filter((f:any)=>String(f)!=='deletedAt'),...Object.keys(fields).filter(k=>!options.mergeFields.some((f:any)=>String(f)===k))]};
                  }else if(method==='update'){
                    const pairs=values.slice(1),precondition=pairs.length%2?pairs.pop():undefined;
                    const requestedIndex=pairs.findIndex((value:any,i:number)=>i%2===0&&String(value)==='isDeleted');
                    const fields=lifecycleFields(previous,requestedIndex<0?undefined:pairs[requestedIndex+1]);
                    const filtered:any[]=[];for(let i=0;i<pairs.length;i+=2)if(String(pairs[i])!=='deletedAt'&&!Object.hasOwn(fields,String(pairs[i])))filtered.push(pairs[i],pairs[i+1]);
                    values=[ref,...filtered,...Object.entries(fields).flat(),...(precondition?[precondition]:[])];
                  }
                }
              }
              tx[method](...timestampWrite(method,path,values,1).map(unwrap));
              if(isSnapshotCollection(documentCollection(path)))changedCompanies.push({collection:documentCollection(path),id:ref.id});
              finalWrites.push({operation:method,collection:documentCollection(path),caller:write.site});
            }
            return result;
          }, ...args.slice(1)).then(async (result: any) => {
            try{for(const collection of new Set(changedCompanies.map(row=>row.collection)))if(isSnapshotCollection(collection))await refreshCompanyDirectoryIds(observed,changedCompanies.filter(row=>row.collection===collection).map(row=>row.id),collection);}catch{console.warn('Company memory refresh failed after committed write');}
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
        if(method==='get'&&(kind==='doc'||kind==='query')&&isSnapshotCollection(shape.collection)){
          const cached=companySourceSnapshot(observed,proxy);if(cached)return cached;
        }
        if(method==='getAll'&&kind==='db'&&args.length&&args.every(ref=>ref?.path)){
          const reads=args.map(ref=>isSnapshotCollection(documentCollection(ref.path))?companySourceSnapshot(observed,ref):undefined);
          if(reads.some(Boolean))return Promise.all(args.map((ref,index)=>reads[index]??ref.get()));
        }
        if (method === 'get' && (kind === 'doc' || kind === 'query') && !shape.clauses.some(clause => clause.startsWith('select('))) {
          const cached = collectionSourceSnapshot(observed, proxy, shape.collection);
          if (cached) return cached;
        }
        if (method === 'getAll' && kind === 'db' && args.length && args.every(ref => typeof ref.onSnapshot === 'function')) {
          const reads = args.map(ref => collectionSourceSnapshot(observed, ref, documentCollection(ref.path)));
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
              if(entityTx&&!actualShape.clauses.some(clause=>clause.startsWith('select('))&&!args.some(arg=>arg?.fieldMask))
                for(const doc of docs)if(doc.ref?.path)entityTx.reads.set(doc.ref.path,doc);
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
    if(isSnapshotCollection(shape.collection)&&(kind==='query'||kind==='doc'))registerCompanySource(proxy,kind==='doc'?target.id:undefined,shape.steps??[],shape.collection);
    return proxy;
  };
  const observed = wrap(db, 'db', { collection: '(multiple)', clauses: [] }) as Firestore;
  instrumented.set(db, observed);
  return observed;
}
