/** Compact secondary Parquet index. Unknown predicates fall back to the full
 * shard files, so adding an application query never silently loses matches.
 * Large search-prefix arrays and captured content stay outside this index. */
export const MARKET_INDEX_FIELDS = [
    'name','slug','slugAliases','status','market','isDeleted','source','sourceLabel','marketCap',
    'symbol','symbolLower','ticker','companyId','companyIds','recordType','sourceType','type','kind',
    'createdAt','updatedAt','date','tradingDate','filingDate','publication_date','published_at','publishedAt',
    'scheduled_date','eventDate','eventTime','earningsDate','cik','exchange_region','entityType','themeIds',
    'outcome','pending','publishPending','manualRequired','lastError','deferredStatus',
    'discoveryCompleteAt','discoveryNextPollAtMs','discoveryPending','discoveryStatus',
    'calendarNextCheckAtMs','headlineTranslationDate','headlineTranslationPending','insiderEnrichmentPending',
    'newsAnalysisNextCheckAtMs','nextCheckAt','nextCheckAtMs','parentCaptureId','parentDeliveryId',
    'inGraph.status','onboarding.status','purpose','score','visibility',
] as const;
const fields = new Set<string>(MARKET_INDEX_FIELDS);
export const marketIndexField = (field:string) => field==='__name__'||fields.has(field);
// Existing announcement fields are response payloads, not predicate keys.
// Format 6 indexes cover these projections without opening full event shards.
export const MARKET_INDEX_PAYLOAD_FIELDS = ['version','id','title','url','sourceId','category','form'] as const;
const payloadFields=new Set<string>(MARKET_INDEX_PAYLOAD_FIELDS);
// Shared indexes retain the source schema's capabilities. Bundling a v3/v5
// index must not claim the announcement payload columns introduced in v6/v7.
export const marketIndexBundled=(format=0)=>format>=100;
export const marketIndexFormat=(format=0)=>marketIndexBundled(format)?format-100:format;
export const marketIndexProjectionField=(field:string,format:number)=>marketIndexField(field)||marketIndexFormat(format)>=6&&payloadFields.has(field);
