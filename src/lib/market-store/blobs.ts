import { createHash } from 'node:crypto';
import type { Bucket } from '@google-cloud/storage';
import { encode, decode } from '../central-cache/codec';
import type { Data } from './value';
/** Internal wire reference, never exposed as an application document field. */
export class MarketBlob {
    constructor(readonly name: string, readonly sha256: string, readonly length: number) { }
}
export async function encodeMarket(value: unknown, bucket: Bucket): Promise<unknown> {
    if (typeof value === 'number' && !Number.isFinite(value))
        return ['market-number', String(value)];
    if (value instanceof MarketBlob)
        return ['market-blob', value.name, value.sha256, value.length];
    if (Buffer.isBuffer(value) && value.length > 16384) {
        const hash = createHash('sha256').update(value).digest('hex'), name = `market-parquet/v1/blobs/${hash}`;
        try {
            await bucket.file(name).save(value, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/octet-stream' } });
        }
        catch (error) {
            if (Number((error as {
                code?: number;
            }).code) !== 412)
                throw error;
        }
        return ['market-blob', name, hash, value.length];
    }
    if (Array.isArray(value)) {
        const result = [];
        for (const item of value)
            result.push(await encodeMarket(item, bucket));
        return ['array', result];
    }
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        const result = [];
        for (const [key, item] of Object.entries(value))
            result.push([key, await encodeMarket(item, bucket)]);
        return ['object', result];
    }
    return encode(value);
}
export function decodeMarket(wire: unknown): Data {
    const [tag, ...values] = wire as [
        string,
        ...unknown[]
    ];
    if (tag === 'market-number') {
        if (!['NaN', 'Infinity', '-Infinity'].includes(String(values[0])))
            throw Error('Invalid market number');
        return Number(values[0]) as unknown as Data;
    }
    if (tag === 'market-blob') {
        const [name, hash, length] = values;
        if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || name !== `market-parquet/v1/blobs/${hash}` || !Number.isSafeInteger(length) || Number(length) < 0)
            throw Error('Invalid market blob');
        return new MarketBlob(String(name), hash, Number(length)) as unknown as Data;
    }
    if (tag === 'array')
        return (values[0] as unknown[]).map(decodeMarket) as unknown as Data;
    if (tag === 'object')
        return Object.fromEntries((values[0] as [
            string,
            unknown
        ][]).map(([key, value]) => [key, decodeMarket(value)]));
    return decode(wire);
}
export async function hydrateMarket<T>(value: T, bucket: Bucket): Promise<T> {
    if (value instanceof MarketBlob) {
        const [bytes] = await bucket.file(value.name).download();
        if (bytes.length !== value.length || createHash('sha256').update(bytes).digest('hex') !== value.sha256)
            throw Error('Market blob integrity check failed');
        return bytes as T;
    }
    if (Array.isArray(value)) {
        const result = [];
        for (const item of value)
            result.push(await hydrateMarket(item, bucket));
        return result as T;
    }
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        const result: Data = {};
        for (const [key, item] of Object.entries(value))
            result[key] = await hydrateMarket(item, bucket);
        return result as T;
    }
    return value;
}
