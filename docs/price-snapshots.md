# Partitioned price snapshots

## EODHD acquisition

Ordinary US and A-share EOD runs fetch whole-exchange daily JSON files without a `symbols` parameter: US, SHG (Shanghai), and SHE (Shenzhen), only for exchanges with requested listings. Raw responses stay in the existing EOD bulk Cloud Storage bucket at `eodhd-bulk-eod/<exchange>/<date>.json`; these are separate from the SQLite files served to the website.

Only the run's interested symbols (enrolled map companies, prediction symbols and the existing benchmark) are selected from those files and written to the existing price documents. Unrelated exchange rows are never imported into Firestore. Symbol mapping preserves dotted US tickers and canonical A-share exchange identities. Every selected bar must match the requested trading date. A missing, invalid or wrong-date bar is repaired through the single-symbol endpoint, so an early cached file cannot hide a later close. Valid stored prices skip provider work; explicit scheduled/A-share ticker repairs retain single-symbol scope. A bulk HTTP failure fails scheduled acquisition instead of launching one request for every symbol. Existing ordinary US Twelve Data fallback remains in place.

New daily requests then use [per-company queued processing](eod-company-queue.md). Company tasks retain corporate-action prerequisites and prediction ordering; portfolio analytics and daily scores wait for every required company receipt. Historical roll-forward and already-checkpointed legacy deliveries retain their original execution path.

## Website snapshots

Each price SQLite file contains one market/ticker/year, for example `price-snapshots/US/NVDA/2026.sqlite`. The website never opens a whole-price directory. Recognized single-ticker document-ID queries and exact document reads load only matching years, newest first for descending queries, stopping once the requested limit is satisfied. Broad maintenance queries remain authoritative Firestore reads.

An instance shares concurrent partition downloads and keeps up to 128 partitions with live subscriptions. Each subscription is restricted to that ticker/year and indexed `updatedAt`, catching up from the file watermark and reconnecting inclusively. Missing files fall back only to that ticker/year. A bounded in-memory ticker listing identifies existing historical years; it is refreshed daily, and the requested end year is always considered. Transaction reads bypass snapshots.

The daily writer reads incremental price changes once, groups them by existing document ID, and conditionally replaces only affected SQLite objects. A small Cloud Storage checkpoint advances only after all partition uploads succeed. Failed runs replay safely. No additional Firestore fields beyond the approved updatedAt/isDeleted/deletedAt lifecycle are required.

## Rollout

1. Deploy timestamp-capable writers and the updatedAt index; keep PRICE_SNAPSHOT_READY unset while legacy writers drain.
2. Backfill using migrate-entity-updated-at with --collection=eod_prices, bounded pages, update preconditions and website monitoring.
3. Verify every price has Timestamp updatedAt. Set PRICE_TIMESTAMP_MIGRATION_COMPLETE=1 for the daily job and run it. Verify price partition objects and checkpoint.
4. Enable PRICE_SNAPSHOT_READY=1 on a no-traffic website candidate. Verify file-read logs include only requested ticker/year objects, then promote with health monitoring and rollback retained.
5. Repeated requests should reuse partitions without additional initial history reads. Incremental change reads and authoritative maintenance/transaction reads remain expected.

The other four entity snapshots keep their existing format and paths. Never publish entity-snapshots/eod_prices.sqlite.
