# Market storage boundary after migration

External data is served by DuckDB over Parquet in GCS. Collection names in the
application are logical repository names: `getAdminFirestore()` and the shared
`scripts` Firestore entry point route them through `market-store/adapter.ts`.
Removing these names would remove application functionality, not Firestore I/O.

## Verified production scope

The global retirement control lists these 17 cleaned collections:
`companies`, `company_directory`, `company_relationships`, `company_research_runs`,
`directory_syncs`, `earnings_records`, `earnings_sources`, `eod_runs`,
`industry_research_candidates`, `industry_research_runs`, `instruments`,
`openai_usage_events`, `sec_filing_sections`, `sec_filings`,
`security_id_mapping_sync_runs`, `security_id_mappings`, `tickers`.

`company_fundamentals` has its own retirement control.
Prices and corporate actions use their dedicated Parquet stores.
`events` is explicitly deferred: feed, calendar and announcements remain on
Firestore. Do not enable its gate or delete its payloads as part of this cleanup.

## References that must remain

- UGC and editorially authored records, including authored company/relationship
  records, remain in Firestore under the existing ownership policy.
- Live leases, queues, deduplication receipts, checkpoints, onboarding state,
  budget ledgers and publication heads remain transactional in Firestore.
- Small Parquet head/control documents in `collectors` coordinate atomic writes.
- The migration/finalization operator tools still support the deferred events
  migration. They are not ordinary application readers.
- SDK snapshot/reference types and logical query syntax are retained for API
  compatibility. A reference object alone does not perform a database read.

The repository merges these retained values with external payloads. A native
query needed for `onboarding.status` therefore remains a real Firestore read.
This cleanup does **not** claim to eliminate that operational scan or all
Firestore usage. The measured directory-read amplification needs its own
shared-cache/freshness design; deleting the status predicate is incorrect.

## Removed bypasses and obsolete paths

- Background-usage inspection and the old central-cache measurement now use
  the Parquet-aware client instead of raw Firestore payload reads.
- Daily snapshot maintenance only bundles Parquet indexes and retires orphaned
  objects; it cannot fall back to publishing legacy Firestore/SQLite snapshots.
- Completed corporate-action, timestamp and instrument-onboarding import
  commands fail immediately, without opening credentials or source collections.
- A cleaned migration control cannot lower `ready` and silently read retired
  Firestore payloads. Events' uncleaned, false gate remains supported.

`market-sdk-boundary.test.ts` rejects new raw SDK client imports outside the
reviewed adapters and operator paths. `market-retirement.test.ts` verifies the
retirement gate and events exception. Emulator tests cover mixed UGC/live-state
and Parquet reads and writes.
