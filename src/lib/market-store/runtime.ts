import type { Firestore } from 'firebase-admin/firestore';
import { Storage, type Bucket } from '@google-cloud/storage';
import { MarketFiles } from './files';
import { MarketRepository } from './repository';
import { marketFirestore } from './adapter';
declare global {
    var __youAnalystMarketStore: {
        clients: WeakMap<Firestore, Firestore>;
        cutover: boolean | undefined;
    } | undefined;
}
const state = globalThis.__youAnalystMarketStore ??= { clients: new WeakMap<Firestore, Firestore>(), cutover: undefined };
export const marketStoreEnabled = () => process.env.MARKET_PARQUET_ENABLED === '1'
    || [process.env.GCP_PROJECT_ID, process.env.GOOGLE_CLOUD_PROJECT, process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID].includes('ifindata-80905');
// Local production-data UI verification only. Cloud Run cannot enable this
// override, and application mutations are rejected by both storage adapters.
export const marketReadOnlyProbe = () => process.env.MARKET_READ_ONLY_PROBE === '1' && !process.env.K_SERVICE && !process.env.CLOUD_RUN_JOB;
// Parquet-only projections are enabled only after observing the read gate.
// Existing snapshot readers are closed by the control subscription at cutover.
export const marketStoreReady = () => marketStoreEnabled() && (marketReadOnlyProbe() || state.cutover === true);
export function enableMarketStore(raw: Firestore, bucket?: Bucket): Firestore {
    if (!marketStoreEnabled())
        return raw;
    let client = state.clients.get(raw);
    if (client)
        return client;
    const name = bucket?.name || process.env.ENTITY_SNAPSHOT_BUCKET || process.env.EODHD_BULK_EOD_BUCKET;
    if (!name)
        throw Error('Market Parquet bucket is required');
    client = marketFirestore(raw, new MarketRepository(raw, new MarketFiles(bucket ?? new Storage().bucket(name)), ready => { state.cutover = ready; if (ready)
        void import('../local-cache/entity-sync').then(module => module.closeEntitySyncs()); }, marketReadOnlyProbe()));
    state.clients.set(raw, client);
    return client;
}
