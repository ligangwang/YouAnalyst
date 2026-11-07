# Latest EOD date and comparison ranges

The EOD finalizer maintains `eod_runs/_latest_US` and `eod_runs/_latest_CN_A` using the existing `market`, `runDate`, `status`, `completedAt`, and `error` fields. No new collection or persisted field is introduced. The pointer is published atomically with the dated run completion after company receipts and portfolio finalization finish. Both COMPLETED and COMPLETED_WITH_ERRORS represent finalized runs; their status remains explicit. Failed/in-progress runs and ticker-scoped or recompute-only runs cannot advance it. Historical replay cannot move it backward.

The legacy continuation path publishes only after its final page succeeds with an actual dated price. Existing installations need no migration: until the first finalized run publishes a pointer, comparison lookup uses the current market date as its upper bound.

`/api/compare?symbols=...&latest=1` reads the saved market boundary and intersects up to 60 recent stored valid closes per selected stock. A completed market run is not itself proof that the selected stocks share a close. Missing recent overlap produces an explicit error, never a fabricated date. The lookup uses document ID ranges, without a new composite index.

The comparison editor separates stock selection from date-range mode. Latest trading date makes both resolved dates read-only; selecting a period calculates From relative to To. Custom dates unlocks both inputs. Compare applies the selection. While open, latest mode checks hourly and when returning to the page; pending requests are cancelled when the user edits/applies a range.
