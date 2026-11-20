import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { Storage, type Bucket } from '@google-cloud/storage';
import { completeParquetHead, MarketFiles } from './files';
import { MarketRepository } from './repository';
import { marketFirestore } from './adapter';
import {isParquetMarketCollection} from './policy';
declare global {
    var __youAnalystMarketStore: {
        clients: WeakMap<Firestore, Firestore>;
        cutover: boolean | undefined;
        fundamentalsCutover?:boolean;
        eventsCutover?:boolean;
        predictionMarksCutover?:boolean;
        repositories?: Set<MarketRepository>;
        readers?: WeakMap<Firestore, MarketRepository>;
    } | undefined;
}
const state = globalThis.__youAnalystMarketStore ??= { clients: new WeakMap<Firestore, Firestore>(), cutover: undefined };
const repositories = state.repositories ??= new Set<MarketRepository>();
/** Jobs must release control/head streams as well as UI cache subscriptions. */
export async function closeMarketStores() {
    const active = [...repositories];
    repositories.clear();
    state.clients = new WeakMap<Firestore, Firestore>();
    state.readers = new WeakMap<Firestore, MarketRepository>();
    state.cutover = undefined;
    state.fundamentalsCutover = undefined;
    state.eventsCutover = undefined;
    state.predictionMarksCutover = undefined;
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
export const fundamentalsStagedReads=()=>process.env.MARKET_FUNDAMENTALS_READ_READY==='1'&&process.env.K_SERVICE==='ifindata-web'&&!process.env.CLOUD_RUN_JOB;
export const eventsStagedReads=()=>process.env.MARKET_EVENTS_READ_READY==='1'&&process.env.K_SERVICE==='ifindata-web'&&!process.env.CLOUD_RUN_JOB;
export const retainedStagedReads=()=>process.env.MARKET_RETAINED_READ_READY==='1'&&process.env.K_SERVICE==='ifindata-web'&&!process.env.CLOUD_RUN_JOB;
export const marketStoreReady = (collection?:string) => (collection===undefined||isParquetMarketCollection(collection))&&marketStoreEnabled() && (marketReadOnlyProbe() || (collection==='prediction_daily_marks'?state.predictionMarksCutover===true:collection==='events'?eventsStagedReads()||state.eventsCutover===true:collection==='company_fundamentals'?fundamentalsStagedReads()||state.fundamentalsCutover===true:marketStagedReads()||state.cutover===true));
/** Resolve this client's authoritative read gate before choosing a legacy snapshot. */
export async function marketStoreClientReady(client:Firestore,collection:string):Promise<boolean> {
    if(!isParquetMarketCollection(collection))return false;
    return await state.readers?.get(client)?.ready(undefined,collection)??false;
}
export async function completeRecordsInParquet(client:Firestore,collection:'companies'|'instruments'):Promise<boolean> {
    const repository=state.readers?.get(client);
    if(!repository)return false;
    const heads=await repository.heads(collection);
    return heads.size===256 && [...heads.values()].every(completeParquetHead);
}
// Capture one catalog generation so a concurrent onboarding edit cannot mix shards.
export async function publishedSupportedInstruments(client:Firestore) {
    const repo=state.readers?.get(client);
    if (!repo || !await repo.ready(undefined,'instruments')) return undefined;
    const heads=[...(await repo.heads('instruments')).values()];
    if (!heads.some(completeParquetHead)) return undefined;
    if (heads.length!==256 || !heads.every(completeParquetHead)) throw Error('Incomplete instrument Parquet catalog');
    // A broad membership query needs the listing fields of most supported rows.
    // Project them in a single DuckDB pass instead of resolving thousands of IDs.
    const rows=await repo.files.query(heads,[
        {method:'where',args:['onboarding.status','==','SUPPORTED']},
        {method:'select',args:['companyId','status','onboarding.status','isDeleted','providerSymbols.youanalyst','symbol']},
    ],false);
    return Promise.all(rows.map(row=>repo.files.hydrate(row)));
}
export function registerObservedMarketClient(client:Firestore,observed:Firestore) {
    const repo=state.readers?.get(client);
    if(repo)state.readers!.set(observed,repo);
}
type FinancialField='value'|'version'|'marketCap'|'isDeleted'|'cnAnnual'|'cnShares'|'cnActions'|'cnOrgId';
/** Align the published rows to caller order, including missing and duplicate IDs. */
export async function readPublishedFinancialRows(db:Firestore,ids:string[],fields:FinancialField[]):Promise<(DocumentData|undefined)[]> {
    if(!ids.length)return [];
    const repo=state.readers?.get(db);
    if(!repo)throw Error('No published financial store configured for this client');
    if(ids.some(id=>id.startsWith('_')))throw Error('Expected company financial record IDs');
    if(!await repo.ready(undefined,'company_fundamentals'))throw Error('Published financial dataset is not ready');
    const byId=new Map<string,DocumentData>();
    const unique=[...new Set(ids)], projection=[...new Set([...fields,'isDeleted'])];
    for(let start=0;start<unique.length;start+=1000){
        const rows=await repo.documents('company_fundamentals',unique.slice(start,start+1000),undefined,projection);
        for(const row of rows)byId.set(row.id,row.data);
    }
    return ids.map(id=>byId.get(id));
}
export async function readPublishedFinancials(db:Firestore,id:string,fields:FinancialField[]){
    return (await readPublishedFinancialRows(db,[id],fields))[0];
}
export async function publishCnAnnual(db: Firestore, annual: import('../fundamentals/cn-annual').CnAnnual) {
    const repository = state.readers?.get(db);
    if (!repository) throw Error('No published financial store configured for this client');
    await repository.updatePublishedFinancialField(annual.companyId, 'cnAnnual', row => {
        const previous = row.cnAnnual as typeof annual | undefined;
        if (previous && (previous.end > annual.end || previous.end === annual.end && previous.updated > annual.updated))
            throw Error('Provider returned an older annual snapshot');
        return annual;
    });
}
export async function updatePublishedMarketCap(db: Firestore, id: string, calculate: (published: DocumentData) => DocumentData) {
    const repository = state.readers?.get(db);
    if (!repository) throw Error('No published financial store configured for this client');
    await repository.updatePublishedMarketCap(id, calculate);
}
export function enableMarketStore(raw: Firestore, bucket?: Bucket): Firestore {
    if (!marketStoreEnabled())
        return raw;
    let client = state.clients.get(raw);
    if (client)
        return client;
    const name = bucket?.name || process.env.ENTITY_SNAPSHOT_BUCKET || process.env.EODHD_BULK_EOD_BUCKET;
    if (!name)
        throw Error('Market Parquet bucket is required');
    const repository = new MarketRepository(raw, new MarketFiles(bucket ?? new Storage().bucket(name)), (ready,collection) => { if(collection==='prediction_daily_marks'){state.predictionMarksCutover=ready;return;} if(collection==='events')state.eventsCutover=ready;else if(collection==='company_fundamentals')state.fundamentalsCutover=ready;else state.cutover = ready; if (ready || marketStagedReads())
        void import('../local-cache/entity-sync').then(module => module.closeEntitySyncs()); }, marketReadOnlyProbe(), marketStagedReads(),true,fundamentalsStagedReads(),true,eventsStagedReads(),retainedStagedReads());
    repositories.add(repository);
    client = marketFirestore(raw, repository);
    (state.readers??=new WeakMap()).set(client,repository);
    state.clients.set(raw, client);
    return client;
}
