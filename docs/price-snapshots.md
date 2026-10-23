# Price SQLite snapshots

Prices now use the shared entity snapshot, lifecycle, startup catch-up and reconnect machinery. `updatedAt` is a server Timestamp; deletes are soft deletes. Transactional reads remain authoritative. Price snapshots skip company search/sitemap indexing and retain ID, ticker, market and trading-date indexes. Only requested payloads are decoded.

## Staged rollout

1. Deploy timestamp-capable writers and the updatedAt index. Keep PRICE_SNAPSHOT_READY unset while old writers drain.
2. Run the existing migrate-entity-updated-at script with --collection=eod_prices, initially dry-run. Apply bounded pages with --after cursors and the compatible website revision; retain its throttling and monitoring.
3. Verify all price documents have Timestamp updatedAt. Set the deployment variable PRICE_TIMESTAMP_MIGRATION_COMPLETE=1 and redeploy the daily snapshot job. Its default is 0, preserving the existing four-collection sync until migration completes.
4. Run the snapshot job and verify entity-snapshots/eod_prices.sqlite and its watermark. Test a candidate website revision with PRICE_SNAPSHOT_READY=1, confirming SQLite load and updatedAt catch-up, then promote with existing health checks. Preserve this runtime setting in subsequent deployments.
5. Verify no full-price initial queries in website logs. Incremental changes since the snapshot still incur Firestore reads per instance, as do authoritative transactions.

No production migration or activation is performed by this source change. The rollout gate can be disabled to return to the previous bounded price-query cache. Daily snapshots retain all historical prices; measure snapshot size and startup memory before activation.
