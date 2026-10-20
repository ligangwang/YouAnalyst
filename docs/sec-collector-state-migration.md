# SEC collector operational state

`sec_collector_state` stores operational bookkeeping only:

- `US:<ticker>`: `secFilingsCollector` scan cursor and polling watermark.
- `_sec_filings_collector`: collector rotation, lease, and run summary.
- `_sec_request_budget`: shared outbound SEC lease, spacing, and cooldown.

Company financial values and refresh results remain in `company_fundamentals`.
Filing discovery records remain in `sec_filings`. Server-only Firestore rules
already deny client access to the new collection.

## Migration behavior

On a missing operational document, cursor reads fall back to legacy fundamentals
without writing (so diagnostics remain read-only). The next collector cursor write
goes only to the new collection. Existing new state always wins. Job metadata is
seeded transactionally before acquiring its lease. The SEC budget's first acquisition
honors legacy lease/spacing/cooldown values. Legacy documents are not deleted or
rewritten, avoiding a bulk fan-out to website listeners.

## Release constraint

This change is local and has not migrated production. Do not deploy it as an
ordinary mixed-version rolling release: old binaries still coordinate on the old
lease and rate-limit documents. Copying those documents alone cannot coordinate
concurrent old/new writers, and an old collector could advance a cursor after it
has been copied.

Before production cutover, implement and deploy a compatibility phase across all
SEC callers that supports a shared transactional migration fence. Old executions
must finish before transferring ownership of each coordination document. Keep
the website and schedules available throughout; do not pause them to perform the
migration. Verify that no legacy workers can acquire the old gate before enabling
new-only coordination. Preserve cooldowns and scan progress at that boundary.

After cutover, verify collector writes target `sec_collector_state`, new financial
data still reaches `company_fundamentals`, and website fundamentals listener updates
no longer follow scan-progress writes. Legacy field cleanup can be a separate,
bounded migration after old binaries are retired.
