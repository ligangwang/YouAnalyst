# Company maintenance queues

## Daily EOD

The existing EOD topic/subscription carries the coordinator and company messages. A coordinator freezes the union of the market's enrolled companies, benchmark, eligible prediction symbols and existing corporate-action/watchlist scope. It reads whole-exchange daily files from the existing bulk bucket and dispatches at most 25 company messages per delivery. Only each requested company's validated price is saved in its receipt; exchange-wide rows remain in Cloud Storage. Missing dated bars are fetched by that company's worker, never by an unrelated task.

Each company uses its own receipt lease, checks corporate-action prerequisites, saves its price and pages only its predictions through the existing single-field ticker index. Prediction transactions retain their existing idempotency and counter updates. Company deliveries do not recompute aggregate user analytics or publish portfolio daily scores. A partially processed company checkpoints its prediction cursor and republishes itself. Failed companies leave their receipt incomplete for normal retry/dead-letter inspection.

After all companies have been dispatched and completed, the coordinator verifies every receipt against the frozen manifest. Only then does it recompute portfolio analytics and daily score snapshots, in resumable pages of 50 daily marks. Users appearing on several pages may be recomputed more than once; their snapshots are deterministic over the completed company marks. One active daily company pipeline spans both markets, preventing overlapping EOD runs from publishing mixed portfolio states. A stalled company blocks finalization rather than silently dropping that company. Queue acceptance for other requests remains available.

The EOD worker uses at most four instances, concurrency one per instance; the coordinator never waits synchronously for children. Existing private IAM/OIDC, 600-second request timeout, retry policy, retention, dead-letter topic, schedules and five-symbol historical-repair budget remain. The worker receives publisher permission on the existing EOD request topic to publish company work and continuations. No additional topic or subscription is created.

## Compatibility and rollout

The new worker accepts the existing version-1 daily request, atomically changes its stored request to version 2 (`eod.company-run.requested`), publishes it, then acknowledges the original message. Replayed version-1 messages republish the saved version-2 request. The previous worker rejects a replay because its stored-request digest no longer matches; it also rejects the new coordinator/company message types. This fences score publication if old and new revisions overlap or the worker is rolled back. Retained messages can be resumed by the compatible worker; never pause subscriptions or cancel active jobs as a shortcut.

Historical roll-forward and legacy requests with an existing `dates` checkpoint finish through their original path. New daily preparation waits for active legacy market leases, and direct maintenance rejects an active company pipeline. Deploy the compatible background consumer before website promotion through the existing protected workflow.

## US market caps

The ordinary US fundamentals publisher still seeds and audits coverage and dispatches SEC work through its existing queue. Instead of recalculating every market cap inline, it freezes a market-cap manifest and sends a coordinator message to the existing fundamentals topic. Each child recalculates exactly one US company's market cap from cached share/price data. Duplicate completed deliveries do not repeat the write. The existing fundamentals `_worker` lease and subscriber concurrency are retained to exclude conflicting SEC refreshes; this split improves retry isolation, not SEC provider parallelism. Explicit direct maintenance retains its original behavior.

## Approved coordination fields

The user approved coordination fields in the existing `eod_runs` and `company_fundamentals` collections. Parent records use `request`, `companyIds`, `phase`, `dispatchCursor`, `completedCompanies`, `finalizeCursor`, `completed`, `completedAt` and existing lease fields. Company receipts use the deterministic `_company_<digest>` ID, `request` (kind, parent run and company identity), `result` (prepared company input), `cursor`, `completed`, `completedAt` and existing lease fields. Pipeline metadata retains `activeRequest` until finalization completes. There is no new collection, index or company/price schema field.

Publication follows durable receipt creation. Dispatch retries reuse the frozen IDs and prepared inputs. A child commits its completion receipt and increments the parent's count in one transaction. The last child publishes the finalizer after that transaction; a duplicate delivery repairs an interrupted notification. The finalizer checks the actual receipts as well as the count, and the original daily dispatch pointer is cleared on completion so manual reruns remain possible.
