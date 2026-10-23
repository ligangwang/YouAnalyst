# Partitioned price snapshots

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
