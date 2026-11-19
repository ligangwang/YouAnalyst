import type { Data } from './value';
export const MARKET_COLLECTIONS = [
    'companies', 'company_directory', 'company_fundamentals', 'company_relationships', 'company_research_runs',
    'directory_syncs', 'earnings_records', 'earnings_sources', 'eod_runs', 'events', 'industry_research_candidates',
    'industry_research_runs', 'instruments', 'openai_usage_events', 'sec_filing_sections', 'sec_filings',
    'security_id_mapping_sync_runs', 'security_id_mappings', 'tickers',
] as const;
export type MarketCollection = typeof MARKET_COLLECTIONS[number];
// Collections can be deferred here until their read paths are verified.
// Events and fundamentals now use independent read and retirement controls.
export const DEFERRED_MARKET_COLLECTIONS = [] as const;
const deferred = new Set<string>(DEFERRED_MARKET_COLLECTIONS);
export const PARQUET_MARKET_COLLECTIONS = MARKET_COLLECTIONS.filter(name=>!deferred.has(name));
const collections = new Set<string>(MARKET_COLLECTIONS);
export const isMarketCollection = (name: string): name is MarketCollection => collections.has(name);
export const isParquetMarketCollection = (name:string): name is MarketCollection => isMarketCollection(name)&&!deferred.has(name);
const operational = new Set([
    'pending', 'requestedAt', 'refreshAfter', 'outcome', 'lastAttemptAt', 'lastError', 'dispatchOwner', 'dispatchAfter',
    'leaseOwner', 'leaseUntil', 'leaseUntilMs', 'leaseExpiresAtMs', 'cnLeaseOwner', 'cnLeaseUntil', 'providerRetryAfter',
    'nextCheckAtMs', 'nextPollAfterMs', 'retryAfter', 'attempts', 'attemptId', 'activeRequest', 'offset', 'checkpoint',
    'secFilingsCollector', 'onboarding', 'privateValuationCheck', 'discoveryEvents', 'discoveryPending',
    'headlineTranslationPending', 'headlineTranslationLeaseOwner', 'headlineTranslationLeaseUntilMs',
    'newsAnalysisPending', 'calendarExtractionPending', 'insiderEnrichmentPending', 'feedCacheChangedAt',
    'publishPending', 'generation', 'processingStartedAt', 'processingFinishedAt',
    'headlineTranslationDate', 'titleTranslationState', 'newsAnalysisNextCheckAtMs', 'newsAnalysis',
    'calendarNextCheckAtMs', 'calendarExtraction', 'lastFilingRefresh', 'cnActions', 'reservationMicros', 'responseId',
    'completed', 'completedAt', 'request', 'publishedEventId', 'manualDispatchUntil', 'manualRequestedAt', 'manualRequired',
    'annualCompleted', 'cnAnnualStatus', 'cnShareStatus', 'cnActionStatus',
]);
const histories = new Set(['company_research_runs', 'directory_syncs', 'eod_runs', 'industry_research_runs', 'security_id_mapping_sync_runs']);
const authored = (data: Data, depth = 0): boolean => ['createdBy', 'updatedBy', 'reviewedBy', 'approvedBy', 'proposedBy', 'userId', 'authorId', 'manualRequestedBy', 'nameEdits', 'editorialReviewedAt', 'communityReviewedAt', 'communityOpenCount', 'aliasReviews'].some(k => data[k] !== undefined && data[k] !== null && data[k] !== '')
    || depth < 8 && Object.values(data).some(value => value && Object.getPrototypeOf(value) === Object.prototype ? authored(value as Data, depth + 1) : Array.isArray(value) && value.some(item => item && Object.getPrototypeOf(item) === Object.prototype && authored(item as Data, depth + 1)));
export const hasAuthoredContent=(data:Data)=>authored(data);
/** Retain entire authored records unless ownership of individual fields is clear.
 * A migration must never reinterpret an editor's content as disposable market data. */
export function retainedWhole(collection: MarketCollection, id: string, data: Data): boolean {
    // A graph source freezes the input filing identity for retries. Its request
    // and processing lease are separate records.
    if (collection === 'company_research_runs' && id.startsWith('_graph_source_')
        && Object.keys(data).length === 3 && data.company && data.filing && data.createdAt && !authored(data))
        return false;
    // Directory batch pages contain only source rows. The parent owns the checkpoint.
    if (collection === 'directory_syncs' && /^_cni_.+_page_\d+$/.test(id)
        && Object.keys(data).length === 1 && Array.isArray(data.companies) && !authored(data))
        return false;
    if (id.startsWith('_') && data.completed !== true)
        return true;
    if (authored(data))
        return true;
    if (collection === 'earnings_sources' && data.recordType === 'source')
        return true;
    if (collection === 'earnings_records' && data.recordType === 'head')
        return true;
    if (collection === 'events' && ['requesting', 'processing'].includes(String(data.status)))
        return true;
    if (collection === 'companies' && (data.status !== 'DIRECTORY' || data.themeMemberships || data.inGraph))
        return true;
    if (collection === 'company_relationships' && !['NEWS_OBSERVATION', 'FILING_OBSERVATION'].includes(String(data.recordKind)))
        return true;
    if (histories.has(collection) && (!data.completedAt && !data.finishedAt && !['complete', 'completed', 'success', 'succeeded', 'failed', 'error', 'cancelled', 'done'].includes(String(data.status ?? data.outcome).toLowerCase()) || data.activeRequest || data.leaseOwner))
        return true;
    return false;
}
export function isOperationalField(collection: MarketCollection, field: string): boolean {
    const root = field.split('.')[0];
    if (collection === 'instruments' && ['onboarding', 'updatedAt'].includes(root))
        return true;
    if (['company_directory', 'sec_filing_sections', 'security_id_mappings', 'tickers', 'instruments'].includes(collection))
        return false;
    if (root === 'updatedAt')
        return true;
    if (operational.has(root))
        return true;
    if (/(?:Pending|LeaseOwner|LeaseUntil|LeaseUntilMs|RequestedAt|DispatchAfter|RetryAfter|NextCheckAtMs|Checkpoint|QueueState)$/.test(root))
        return true;
    if (collection === 'industry_research_candidates' && ['status', 'attempts', 'lastError', 'requestedAt'].includes(root))
        return true;
    if (collection === 'events' && ['status', 'contentHash', 'priorEventIds', 'eventIds', 'usageEventId', 'identityResolutions', 'relationshipPublication', 'generation'].includes(root))
        return true;
    return false;
}
export const isRoutingField = (field: string) => ['companyId', 'companyIds', 'ticker', 'market', 'type', 'sourceType', 'recordType'].includes(field);
/** Predicates that can only match whole records retained for authorship or live
 * workflow state. Avoid scanning unrelated external Parquet files for these. */
export function retainedOnlyQuery(collection: MarketCollection, steps: Array<{
    method: string;
    args: unknown[];
}>) {
    return steps.some(step => {
        if (step.method !== 'where' || typeof step.args[0] !== 'string')
            return false;
        const [field, operator, value] = step.args;
        if (collection === 'companies' && (field.startsWith('inGraph.') || field.startsWith('themeMemberships.')))
            return true;
        const values = operator === '==' ? [value] : operator === 'in' && Array.isArray(value) ? value : undefined;
        if (!values?.length)
            return false;
        if (collection === 'companies' && field === 'status')
            return values.every(value => value !== 'DIRECTORY');
        if (collection === 'events' && field === 'status')
            return values.every(value => ['requesting', 'processing'].includes(String(value)));
        return field === 'recordType' && (collection === 'earnings_records' && values.every(v => v === 'head') || collection === 'earnings_sources' && values.every(v => v === 'source'));
    });
}
const financialFields=new Set(['value','version','marketCap','cnAnnual','isDeleted']);
export const publishedFinancialField=(field:string)=>financialFields.has(field.split('.')[0]);
// Completed US refreshes can be read from immutable company rows. Positive
// pending queries and unresolved failures still use the active worker index.
const settledFields = new Set(['refreshAfter','pending','outcome','requestedAt','dispatchAfter','dispatchOwner',
    'lastAttemptAt','lastError','lastFilingRefresh','secFilingsCollector','failedAt','updatedAt']);
export function settledWorkerField(field: string, operator?: unknown, operand?: unknown) {
    const root=field.split('.')[0];
    if (!settledFields.has(root)) return false;
    const values=operator==='=='?[operand]:operator==='in'&&Array.isArray(operand)?operand:undefined;
    if (values && root==='pending') return values.includes(false);
    if (values && root==='outcome') return values.includes('ready') || values.includes('unavailable');
    return true;
}
const receiptFields = new Set([
    'request', 'progress', 'result', 'annual', 'annualCompleted', 'createdAt', 'updatedAt', 'dispatchedAt',
    'completed', 'completedAt', 'manualRequired', 'publishedEventId', 'verificationDuplicateRunId', 'cursor',
]);
export const fundamentalsReceiptId = (id: string) => id.startsWith('_batch_') || id.startsWith('_cn_request_') || id.startsWith('_company_');
export function archivedFundamentalsReceipt(id: string, data: Data) {
    return fundamentalsReceiptId(id) && data.completed === true && data.manualRequired !== true
        && data.cursor == null && !!data.request && !authored(data) && Object.keys(data).every(key => receiptFields.has(key));
}
/** An archived receipt can satisfy predicates on its own fields. Worker company
 * status and lease predicates still use their bounded operational indexes. */
export function receiptHasField(field: string) {
    return field === '__name__' || receiptFields.has(field.split('.')[0]);
}
export function splitRecord(collection: MarketCollection, id: string, data: Data, fieldsOnly = false): {
    external: Data;
    retained: Data;
} {
    // fieldsOnly merges older split rows while the stored receipt is being read.
    if (!fieldsOnly && collection === 'company_fundamentals' && archivedFundamentalsReceipt(id, data))
        return {external: data, retained: {}};
    // An authored company row can contain both editorial metadata and a
    // published financial payload. Public readers use only the Parquet copy.
    if (collection === 'company_fundamentals' && !id.startsWith('_') && authored(data)) {
        const external: Data = {}, retained: Data = {};
        for (const [key,value] of Object.entries(data))
            (financialFields.has(key) ? external : retained)[key] = value;
        return {external,retained};
    }
    // A refresh date alone is scheduling metadata on the published company row.
    // Existing overlays still need their date when merging pre-migration records.
    if (!fieldsOnly && collection === 'company_fundamentals' && id.startsWith('US:')
        && typeof data.refreshAfter === 'number' && Number.isFinite(data.refreshAfter)
        && Object.keys(data).every(key => financialFields.has(key) || ['refreshAfter','updatedAt','unavailableReason'].includes(key)))
        return {external: data, retained: {}};
    if (!fieldsOnly && retainedWhole(collection, id, data))
        return { external: {}, retained: data };
    const external: Data = {}, retained: Data = {};
    for (const [key, value] of Object.entries(data))
        (key !== 'updatedAt' && isOperationalField(collection, key) ? retained : external)[key] = value;
    // Deduplication receipts remain transactional; their historical usage payload moves.
    if (collection === 'openai_usage_events' && data.id !== undefined)
        retained.id = data.id;
    if (Object.keys(retained).length)
        for (const [key, value] of Object.entries(data))
            if (isRoutingField(key))
                retained[key] = value;
    if (Object.keys(retained).length && data.updatedAt !== undefined) {
        retained.updatedAt = data.updatedAt;
        delete external.updatedAt;
    }
    return { external, retained };
}
export function retainsRecord(collection:MarketCollection,id:string,data:Data,retained:Data){
    return Object.keys(retained).length>0||(Object.keys(data).length===0&&retainedWhole(collection,id,data));
}
