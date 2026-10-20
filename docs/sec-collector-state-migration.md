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
