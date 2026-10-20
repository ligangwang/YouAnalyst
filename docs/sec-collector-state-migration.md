# SEC operational-state rollout

The approved `sec_collector_state` collection holds company scan cursors,
collector locks and the shared SEC request gate. Company financial values stay
in `company_fundamentals`; discovered filings stay in `sec_filings`.

New code initially runs a compatibility bridge. Collector leases and cursor writes
are mirrored atomically to legacy state, and new request-gate acquisitions share
the legacy gate. This keeps old and new binaries serialized during rollout.

After all SEC callers are updated and every old-image execution has completed,
run `scripts/finalize-sec-state.ts --apply --legacy-workers-drained`. This command
acquires both collector leases, copies legacy cursor state in throttled batches,
waits for the request gate to be idle, preserves its cooldown, and retires both
bridges transactionally. Active collectors cause a safe failure; retry later.
Do not stop schedules or the website. Verify the deployed images/executions before
asserting they have drained. Old binaries must not be redeployed after retirement.

After retirement, ordinary cursor, lease and throttle writes only touch the new
collection. Legacy cursors are a read-only fallback for unmigrated documents.
Legacy data is retained; any cleanup is a separate bounded operation. The migration
is resumable and doesn't overwrite financial fields. Monitor website health and
cache-change fan-out throughout migration batches.

The website listens only to `sec_collector_state/_website_freshness`, containing
`lastRunAt` and the run result's `failed`, `partial`, `remaining`, and
`outboxIncomplete` fields. The collector publishes this summary atomically with
its legacy last-run metadata at completion. Cursor and lease writes do not touch
the summary. Deploy the collector first and verify a summary exists before
switching website traffic. A missing summary is shown as unverified freshness;
the website never falls back to listening to the bookkeeping document.

SEC disclosure overlap scans retain `confirmedDisclosures` on the existing
`collectors/sec-<companyId>` document. These exact event IDs are recorded only
after persistence succeeds, retained inside the scan window, and capped at 2,000
per company. Unseen accessions still use transactional existence checks.
Older collector state needs no backfill: its first scan checks events and builds
the list. For explicit reconciliation of manually deleted event documents, clear
`confirmedDisclosures` before a fresh scan covering those dates. Routine scans
do not recheck confirmed event existence.

Collector consumers also use two compact projections in the existing `collectors`
collection. `sec-identity-<companyId>` contains only `companyId` and `cik`; the SEC
disclosure observer publishes it atomically with `identitySummaryCik` on its
checkpoint, and republishes only when the verified CIK changes.
`news-health-<sourceId>` contains `lastSuccessAt`, `failures`, and `partial`,
published in the news commit/failure transaction, never on lease acquisition.
Earnings identity consumers and website news health read these projections.
The SEC scanner's writable initial checkpoints still come from full state.

Before deploying consumers, populate and verify the identity projections for
currently eligible US companies and health projections for configured sources,
using the existing validated collector state or updated producers. Missing
identities remain ineligible and missing health remains unverified; consumers
do not fall back to watching noisy bookkeeping documents. Retain legacy state
throughout the rolling release so older consumers continue working.

CNINFO disclosure overlap scans now retain up to 2,000 confirmed disclosure IDs
and publication dates in each existing `collectors/exchange-${companyId}`
checkpoint. Receipts are saved only after event persistence succeeds and are
pruned to the current scan window. New IDs still use transactional duplicate
checks. Missing receipts or failed checkpoint writes safely cause extra reads.
For an explicit repair of manually deleted event documents, clear that company's
`confirmedDisclosures` and `nextPollAtMs` before rerunning its scan. No backfill
is required; the first successful scan populates receipts.
