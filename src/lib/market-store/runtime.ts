import type { Firestore } from 'firebase-admin/firestore';
import { Storage, type Bucket } from '@google-cloud/storage';
import { MarketFiles } from './files';
import { MarketRepository } from './repository';
import { marketFirestore } from './adapter';
declare global {
    var __youAnalystMarketStore: {
        clients: WeakMap<Firestore, Firestore>;
        cutover: boolean | undefined;
        repositories?: Set<MarketRepository>;
    } | undefined;
}
const state = globalThis.__youAnalystMarketStore ??= { clients: new WeakMap<Firestore, Firestore>(), cutover: undefined };
const repositories = state.repositories ??= new Set<MarketRepository>();
/** Jobs must release control/head streams as well as UI cache subscriptions. */
export async function closeMarketStores() {
    const active = [...repositories];
    repositories.clear();
    state.clients = new WeakMap<Firestore, Firestore>();
    state.cutover = undefined;
    await Promise.all(active.map(repository => repository.close()));
}
export const marketStoreEnabled = () => process.env.MARKET_PARQUET_ENABLED === '1'
    || [process.env.GCP_PROJECT_ID, process.env.GOOGLE_CLOUD_PROJECT, process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID].includes('ifindata-80905');
// Production-data UI checks run locally or in the isolated, zero-user-traffic
// probe service. The serving website and workers cannot enable this override;
// application mutations are rejected by both storage adapters.
export const marketReadOnlyProbe = () => process.env.MARKET_READ_ONLY_PROBE === '1'
    && (!process.env.K_SERVICE || process.env.K_SERVICE === 'market-parquet-ui-probe') && !process.env.CLOUD_RUN_JOB;
// Opt in one web revision before traffic promotion. Unlike the isolated probe,
// this does not reject user writes or override transactional cleanup controls.
export const marketStagedReads = () => process.env.MARKET_PARQUET_READ_READY === '1'
    && process.env.K_SERVICE === 'ifindata-web' && !process.env.CLOUD_RUN_JOB;
// Use Parquet projections from startup for an opted-in candidate, or after the
// shared read gate is observed by other processes.
// Existing snapshot readers are closed by the control subscription at cutover.
export const marketStoreReady = () => marketStoreEnabled() && (marketStagedReads() || marketReadOnlyProbe() || state.cutover === true);
export function enableMarketStore(raw: Firestore, bucket?: Bucket): Firestore {
    if (!marketStoreEnabled())
        return raw;
    let client = state.clients.get(raw);
    if (client)
        return client;
    const name = bucket?.name || process.env.ENTITY_SNAPSHOT_BUCKET || process.env.EODHD_BULK_EOD_BUCKET;
    if (!name)
        throw Error('Market Parquet bucket is required');
    const repository = new MarketRepository(raw, new MarketFiles(bucket ?? new Storage().bucket(name)), ready => { state.cutover = ready; if (ready || marketStagedReads())
        void import('../local-cache/entity-sync').then(module => module.closeEntitySyncs()); }, marketReadOnlyProbe(), marketStagedReads());
    repositories.add(repository);
    client = marketFirestore(raw, repository);
    state.clients.set(raw, client);
    return client;
}
