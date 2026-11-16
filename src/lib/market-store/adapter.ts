/* eslint-disable @typescript-eslint/no-explicit-any -- Preserve the Firestore SDK overloads at the storage boundary. */
import { Timestamp, DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { Readable } from 'node:stream';
import { MarketRepository, type MarketContext, type Mutation } from './repository';
import { isMarketCollection, type MarketCollection } from './policy';
import { clone, getField, fieldName } from './value';
import { project, type Step } from './query';
import type { MarketRow } from './files';
import { encode } from '../central-cache/codec';
type Spec = {
    collection: MarketCollection;
    id?: string;
    steps: Step[];
    kind: 'doc' | 'query' | 'aggregate';
};
export function marketFirestore(raw: Firestore, repository: MarketRepository): Firestore {
    const originals = new WeakMap<object, any>(), specs = new WeakMap<object, Spec>();
    const unwrap = (value: any): any => originals.get(value) ?? value;
    const specification = (ref: any): Spec | undefined => { const known = specs.get(ref); if (known)
        return known; const parts = String(ref?.path ?? '').split('/'); return parts.length === 2 && isMarketCollection(parts[0]) ? { collection: parts[0], id: parts[1], steps: [], kind: 'doc' } : undefined; };
    const identity = (spec: Spec) => JSON.stringify({ ...spec, steps: spec.steps.map(step => ({ ...step, args: step.args.map((value: any) => value?.ref ? { cursor: value.ref.path, version: encode(value.updateTime) } : value?.constructor?.name === 'FieldPath' ? { field: fieldName(value) } : encode(value)) })) });
    const document = (collection: MarketCollection, id: string, row?: MarketRow, fields?: string[]) => {
        const data = row && (fields ? project(row.data, fields) : row.data), ref = db.collection(collection).doc(id);
        return { id, ref, exists: !!row, readTime: Timestamp.now(), updateTime: row?.version, createTime: row?.version, data: () => data && clone(data), get: (field: unknown) => data && clone(getField(data, field)), isEqual: (other: any) => other?.ref?.path === ref.path && other?.updateTime?.isEqual(row?.version) };
    };
    const page = (collection: MarketCollection, rows: MarketRow[]) => { const docs = rows.map(row => document(collection, row.id, row)); return { docs, size: docs.length, empty: !docs.length, readTime: Timestamp.now(), forEach: (fn: (doc: any) => void, thisArg?: unknown) => docs.forEach(doc => fn.call(thisArg, doc)), docChanges: () => docs.map(doc => ({ type: 'added', doc, oldIndex: -1, newIndex: docs.indexOf(doc) })) }; };
    async function read(spec: Spec, context?: MarketContext, fields?: string[]) {
        if (spec.id !== undefined) {
            const rows = await repository.documents(spec.collection, [spec.id], context);
            return document(spec.collection, spec.id, rows[0], fields);
        }
        // Counts only need identities and predicate/order fields. Do not hydrate
        // archived filing bodies or other large payloads for an aggregate.
        const steps = spec.kind === 'aggregate' ? [...spec.steps.filter(step => step.method !== 'select'), { method: 'select', args: [] }] : spec.steps;
        const rows = await repository.query(spec.collection, steps, context);
        if (spec.kind === 'aggregate')
            return { data: () => ({ count: rows.length }), readTime: Timestamp.now() };
        return page(spec.collection, rows);
    }
    async function getMany(refs: any[], fields: string[] | undefined, context: MarketContext | undefined, nativeGet: (...args: any[]) => Promise<any[]>) {
        const routed = refs.some(ref => specification(ref)) && await repository.ready(context);
        const result = new Map<string, any>(), groups = new Map<MarketCollection, string[]>(), nativeRefs: any[] = [];
        for (const ref of refs) {
            const spec = routed ? specification(ref) : undefined;
            if (spec?.id !== undefined) {
                const ids = groups.get(spec.collection) ?? [];
                ids.push(spec.id); groups.set(spec.collection, ids);
            } else nativeRefs.push(unwrap(ref));
        }
        if (nativeRefs.length) for (const doc of await nativeGet(...nativeRefs, ...(fields ? [{fieldMask:fields}] : []))) {
            result.set(doc.ref.path, doc);
            if (context && !fields) context.documents.set(doc.ref.path, doc);
        }
        for (const [collection, ids] of groups) {
            const rows = new Map((await repository.documents(collection, [...new Set(ids)], context)).map(row => [row.id,row]));
            for (const id of ids) result.set(collection+'/'+id, document(collection,id,rows.get(id),fields));
        }
        return refs.map(ref => result.get(ref.path));
    }
    async function transaction(work: (tx: any) => Promise<any>, options?: any) {
        let changed: string[] = [];
        return raw.runTransaction(async (native) => {
            const context = repository.context({ get: ref => native.get(ref as any), getAll: (...refs) => native.getAll(...refs) });
            const pending: Array<{
                method: string;
                args: any[];
            }> = [];
            const tx = new Proxy(native, { get(target, key) {
                    if (key === 'get')
                        return async (ref: any, ...args: any[]) => { const spec = specification(ref); if (spec && await repository.ready(context))
                            return read(spec, context, args[0]?.fieldMask); const doc = await (target.get as any)(unwrap(ref), ...args); if (doc.ref && !args[0]?.fieldMask)
                            context.documents.set(doc.ref.path, doc); return doc; };
                    if (key === 'getAll')
                        return async (...args: any[]) => { const fields = args.at(-1)?.fieldMask, refs = fields ? args.slice(0, -1) : args; return getMany(refs,fields,context,(...values)=>(target.getAll as any)(...values)); };
                    if (['set', 'update', 'create', 'delete'].includes(String(key)))
                        return (...args: any[]) => { pending.push({ method: String(key), args }); return tx; };
                    const member = Reflect.get(target, key, target);
                    return typeof member === 'function' ? member.bind(target) : member;
                } });
            const result = await work(tx);
            const market: Mutation[] = [], ordinary: Array<{
                method: string;
                args: any[];
            }> = [];
            for (const write of pending) {
                const path = write.args[0]?.path, parts = String(path).split('/');
                if (parts.length === 2 && isMarketCollection(parts[0]))
                    market.push({ path, method: write.method, args: write.args.slice(1) });
                else
                    ordinary.push(write);
            }
            const commit = market.length ? await repository.prepare(context, native, market) : () => { };
            changed = market.map(write => write.path);
            commit();
            for (const write of ordinary)
                (native[write.method as keyof typeof native] as any)(...write.args.map(unwrap));
            return result;
        }, options).then(async (result) => { await repository.committed(changed); return result; });
    }
    function wrap(target: any, spec: Spec): any {
        const proxy = new Proxy(target, { get(object, key) {
                if (key === 'firestore')
                    return db;
                if (key === 'parent' && object.parent)
                    return spec.kind === 'doc' ? wrap(object.parent, { collection: spec.collection, steps: [], kind: 'query' }) : object.parent;
                const member = Reflect.get(object, key, object);
                if (typeof member !== 'function')
                    return member;
                const method = String(key);
                if (method === 'isEqual')
                    return (other: any) => { const found = specification(other); return !!found && identity(spec) === identity(found); };
                if (method === 'doc')
                    return (...args: any[]) => { const ref = member.apply(object, args); return wrap(ref, { collection: spec.collection, id: ref.id, steps: [], kind: 'doc' }); };
                if (['where', 'orderBy', 'limit', 'limitToLast', 'offset', 'select', 'startAt', 'startAfter', 'endAt', 'endBefore', 'count'].includes(method))
                    return (...args: any[]) => {
                        // Cursors may be synthetic Parquet snapshots. Keep them in our query plan;
                        // the native bootstrap query is reconstructed only if it is actually read.
                        const native = ['startAt', 'startAfter', 'endAt', 'endBefore'].includes(method) && args[0]?.ref && !(args[0] instanceof DocumentSnapshot) ? object : member.apply(object, args.map(unwrap));
                        return wrap(native, { ...spec, kind: method === 'count' ? 'aggregate' : spec.kind, steps: [...spec.steps, { method, args }] });
                    };
                if (method === 'get')
                    return async (...args: any[]) => {
                        if (await repository.ready())
                            return read(spec, undefined, args[0]?.fieldMask);
                        return member.apply(object, args.map(unwrap));
                    };
                if (['set', 'create', 'update', 'delete'].includes(method))
                    return (...args: any[]) => transaction(async (tx) => { tx[method](proxy, ...args); }).then(() => ({ writeTime: Timestamp.now() }));
                if (method === 'add')
                    return async (data: any) => { const ref = proxy.doc(); await ref.create(data); return ref; };
                if (method === 'onSnapshot')
                    return (next: any, error?: any) => {
                        let stopped = false, timer: NodeJS.Timeout | undefined, unsubscribe: (() => void) | undefined, running = false, dirty = false;
                        let previous: any[] = [];
                        const refresh = () => { dirty = true; if (running || stopped)
                            return; running = true; void (async () => { try {
                            while (dirty && !stopped) {
                                dirty = false;
                                const value = await proxy.get();
                                if (stopped)
                                    return;
                                if (value.docs) {
                                    const before = new Map(previous.map((doc, i) => [doc.id, { doc, i }])), after = new Map(value.docs.map((doc: any, i: number) => [doc.id, { doc, i }])), changes: any[] = [];
                                    for (const [id, old] of before)
                                        if (!after.has(id))
                                            changes.push({ type: 'removed', doc: old.doc, oldIndex: old.i, newIndex: -1 });
                                    for (const [i, doc] of value.docs.entries()) {
                                        const old = before.get(doc.id);
                                        if (!old || !doc.updateTime?.isEqual(old.doc.updateTime))
                                            changes.push({ type: old ? 'modified' : 'added', doc, oldIndex: old?.i ?? -1, newIndex: i });
                                    }
                                    previous = value.docs;
                                    value.docChanges = () => changes;
                                }
                                next(value);
                            }
                        }
                        catch (e) {
                            error?.(e);
                        }
                        finally {
                            running = false;
                        } })(); };
                        // A shared subscription to small head pointers drives existing UI caches.
                        // There is no steady polling or listener over external source documents.
                        const check = async () => { try {
                            if (await repository.ready()) {
                                unsubscribe?.();
                                if (stopped)
                                    return;
                                const names = spec.steps.find(s => s.method === 'where' && fieldName(s.args[0]) === '__name__' && ['==', 'in'].includes(String(s.args[1])));
                                const ids = spec.id !== undefined ? [spec.id] : names ? names.args[1] === 'in' ? names.args[2] as string[] : [String(names.args[2])] : undefined;
                                unsubscribe = repository.subscribe(spec.collection, ids, refresh, e => error?.(e));
                                return;
                            }
                            if (!unsubscribe && !stopped)
                                unsubscribe = member.call(object, next, error);
                        }
                        catch (e) {
                            error?.(e);
                        } if (!stopped) {
                            timer = setTimeout(check, 1000);
                            timer.unref();
                        } };
                        void check();
                        return () => { stopped = true; unsubscribe?.(); if (timer)
                            clearTimeout(timer); };
                    };
                if (method === 'stream')
                    return () => Readable.from((async function* () { const result = await proxy.get(); for (const doc of result.docs)
                        yield doc; })(), { objectMode: true });
                if (['withConverter', 'aggregate', 'listDocuments', 'getPartitions', 'listCollections'].includes(method))
                    return () => { throw Error(`Unsupported market operation ${method}`); };
                return (...args: any[]) => member.apply(object, args.map(unwrap));
            } });
        originals.set(proxy, target);
        specs.set(proxy, spec);
        return proxy;
    }
    const db: Firestore = new Proxy(raw, { get(target, key) {
            if (key === 'collection')
                return (path: string) => { const collection = target.collection(path); return isMarketCollection(path) ? wrap(collection, { collection: path, steps: [], kind: 'query' }) : collection; };
            if (key === 'doc')
                return (path: string) => { const parts = path.split('/'), ref = target.doc(path); return parts.length === 2 && isMarketCollection(parts[0]) ? wrap(ref, { collection: parts[0], id: parts[1], steps: [], kind: 'doc' }) : ref; };
            if (key === 'runTransaction')
                return transaction;
            if (key === 'getAll')
                return async (...args: any[]) => { const fields = args.at(-1)?.fieldMask, refs = fields ? args.slice(0, -1) : args; return getMany(refs,fields,undefined,(...values)=>(target.getAll as any)(...values)); };
            if (key === 'batch')
                return () => { const writes: Array<{
                    method: string;
                    args: any[];
                }> = []; const batch: any = { commit: () => transaction(async (tx) => { for (const write of writes)
                        tx[write.method](...write.args); }).then(() => writes.map(() => ({ writeTime: Timestamp.now() }))) }; for (const method of ['set', 'create', 'update', 'delete'])
                    batch[method] = (...args: any[]) => { writes.push({ method, args }); return batch; }; return batch; };
            if (key === 'collectionGroup')
                return (name: string) => { if (isMarketCollection(name))
                    throw Error('Market collection group queries require an explicit root collection'); return target.collectionGroup(name); };
            if (key === 'recursiveDelete')
                return (ref: any, ...args: any[]) => { if (isMarketCollection(String(ref.path).split('/')[0]))
                    throw Error('Market data deletion requires a verified migration or repository mutation'); return (target.recursiveDelete as any)(unwrap(ref), ...args); };
            if (key === 'bulkWriter')
                return () => { throw Error('Use transactional batches through the market repository; native BulkWriter bypasses Parquet publication'); };
            if (key === 'terminate')
                return async () => { await repository.close(); return target.terminate(); };
            const member = Reflect.get(target, key, target);
            return typeof member === 'function' ? member.bind(target) : member;
        } });
    return db;
}
