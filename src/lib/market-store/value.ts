import { FieldPath, FieldValue, Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { isDeepStrictEqual } from 'node:util';
import { encode, decode } from '../central-cache/codec';
import { MarketBlob } from './blobs';
export type Data = Record<string, unknown>;
export const clone = <T>(value: T): T => decode(encode(value)) as T;
export function pathParts(value: unknown): string[] {
    if (value instanceof FieldPath)
        return [...(value as unknown as {
                segments: string[];
            }).segments];
    if (typeof value !== 'string' || !value)
        throw Error('Invalid field path');
    return value.split('.');
}
export const fieldName = (value: unknown) => pathParts(value).join('.');
export function getField(data: Data, path: unknown): unknown { return pathParts(path).reduce<unknown>((v, k) => v && typeof v === 'object' ? (v as Data)[k] : undefined, data); }
function assign(data: Data, path: string[], value: unknown) { let target = data; for (const k of path.slice(0, -1)) {
    const prior = target[k];
    target = target[k] = prior && Object.getPrototypeOf(prior) === Object.prototype ? { ...prior as Data } : {};
} if (value === DELETE)
    delete target[path.at(-1)!];
else
    target[path.at(-1)!] = value; }
const DELETE = Symbol('delete');
function resolve(value: unknown, previous: unknown, at: Timestamp): unknown {
    if(value===undefined)throw Error('Cannot write undefined to a market document');
    // Firestore persists dates as timestamps at microsecond precision.
    if(value instanceof Date)value=Timestamp.fromDate(value);
    if(value instanceof Timestamp)return new Timestamp(value.seconds,Math.floor(value.nanoseconds/1000)*1000);
    if(Array.isArray(value))return value.map(item=>{
        if(item instanceof FieldValue)throw Error('Field transforms cannot appear inside arrays');
        return resolve(item,undefined,at);
    });
    if (value instanceof FieldValue) {
        const kind = value.constructor.name, transform = value as unknown as {
            operand: number;
            elements: unknown[];
        };
        if (kind === 'DeleteTransform')
            return DELETE;
        if (kind === 'ServerTimestampTransform')
            return at;
        if (kind === 'NumericIncrementTransform')
            return (typeof previous === 'number' ? previous : 0) + transform.operand;
        if (kind === 'ArrayUnionTransform') {
            const result = Array.isArray(previous) ? [...previous] : [];
            for (const item of transform.elements.map(value=>resolve(value,undefined,at)))
                if (!result.some(old => isDeepStrictEqual(old, item)))
                    result.push(clone(item));
            return result;
        }
        if (kind === 'ArrayRemoveTransform')
            return (Array.isArray(previous) ? previous : []).filter(item => !transform.elements.map(value=>resolve(value,undefined,at)).some(old => isDeepStrictEqual(old, item)));
        throw Error('Unsupported Firestore transform');
    }
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        const out: Data = {};
        for (const [k, v] of Object.entries(value)) {
            const result = resolve(v, previous && typeof previous === 'object' ? (previous as Data)[k] : undefined, at);
            if (result !== DELETE)
                out[k] = result;
        }
        return out;
    }
    return clone(value);
}
export function applyMutation(previous: Data | undefined, method: string, args: unknown[], at: Timestamp): Data | undefined {
    if (method === 'delete')
        return undefined;
    if (method === 'create' && previous !== undefined)
        throw Object.assign(Error('Document already exists'), { code: 6 });
    if (method === 'update' && previous === undefined)
        throw Object.assign(Error('Document does not exist'), { code: 5 });
    const options = args[1] as {
        merge?: boolean;
        mergeFields?: unknown[];
    } | undefined;
    const data = args[0];
    if (method === 'create' || method === 'set' && !options?.merge && !options?.mergeFields)
        return resolve(data, previous, at) as Data;
    const out = clone(previous ?? {});
    const entries: Array<[
        string[],
        unknown
    ]> = [];
    if (method === 'update') {
        if (data && Object.getPrototypeOf(data) === Object.prototype)
            for (const [key, value] of Object.entries(data))
                entries.push([pathParts(key), value]);
        else {
            const pairs = args.length % 2 ? args.slice(0, -1) : args;
            for (let i = 0; i < pairs.length; i += 2)
                entries.push([pathParts(pairs[i]), pairs[i + 1]]);
        }
    }
    else if (options?.mergeFields) {
        for (const name of options.mergeFields) {
            const value = getField(data as Data, name);
            if (value === undefined)
                throw Error('Missing mergeFields value');
            entries.push([pathParts(name), value]);
        }
    }
    else {
        const visit = (v: unknown, path: string[]) => { if (v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length) {
            for (const [k, item] of Object.entries(v))
                visit(item, [...path, k]);
        }
        else
            entries.push([path, v]); };
        for (const [key, value] of Object.entries(data as Data))
            visit(value, [key]);
    }
    for (const [path, value] of entries)
        assign(out, path, resolve(value, getField(out, new FieldPath(...path)), at));
    return out;
}
/** Lexicographic keys preserve Firestore's type order and exact timestamps. */
export function sortKey(value: unknown): string | undefined {
    if (value === undefined)
        return undefined;
    if (value === null)
        return '0';
    if (typeof value === 'boolean')
        return value ? '11' : '10';
    if (typeof value === 'number') {
        if (Number.isNaN(value))
            return '20';
        const bytes = Buffer.alloc(8);
        bytes.writeDoubleBE(Object.is(value, -0) ? 0 : value);
        if (bytes[0] & 128)
            for (let i = 0; i < 8; i++)
                bytes[i] ^= 255;
        else
            bytes[0] ^= 128;
        return '21' + bytes.toString('hex');
    }
    if (value instanceof Timestamp)
        return '3' + String(value.seconds + 62135596800).padStart(12, '0') + String(value.nanoseconds).padStart(9, '0');
    if (value instanceof Date)
        return sortKey(Timestamp.fromDate(value));
    if (typeof value === 'string')
        return '4' + Buffer.from(value).toString('hex');
    if (Buffer.isBuffer(value))
        return '5' + value.toString('hex');
    if (value instanceof GeoPoint)
        return '7' + sortKey(value.latitude) + sortKey(value.longitude);
    if (Array.isArray(value))
        return '8' + value.map(v => sortKey(v) + '!').join('');
    if (value && Object.getPrototypeOf(value) === Object.prototype)
        return '9' + Object.entries(value).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([k, v]) => sortKey(k) + '!' + sortKey(v) + '!').join('');
    throw Error('Unsupported market-store value');
}
export function queryIndex(data: Data) {
    const keys: Record<string, string> = {}, arrays: Record<string, string[]> = {};
    const visit = (value: unknown, path: string[]) => { if (value instanceof MarketBlob || Buffer.isBuffer(value) && value.length > 16384)
        return; const name = path.join('.'); let key: string | undefined; try {
        key = sortKey(value);
    }
    catch {
        key = undefined;
    } if (key !== undefined)
        keys[name] = key; if (Array.isArray(value))
        arrays[name] = value.map(v => sortKey(v)!);
    else if (value && Object.getPrototypeOf(value) === Object.prototype)
        for (const [k, v] of Object.entries(value))
            visit(v, [...path, k]); };
    for (const [k, v] of Object.entries(data))
        visit(v, [k]);
    return { keys, arrays };
}
