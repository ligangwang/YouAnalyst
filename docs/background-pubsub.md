# Background Pub/Sub jobs

This rollout extends the existing SEC pattern to private valuation checks, ticker
catalog sync, A-share fundamentals, China directory imports, and US/China EOD
maintenance. Existing recurring maintenance now runs behind Pub/Sub subscribers.

| Work | Request topic | Subscriber service | Durable state |
| --- | --- | --- | --- |
| SEC fundamentals | `sec-fundamentals-requests` | `sec-fundamentals-subscriber` | `company_fundamentals/_batch_<id>` |
| Private valuations | `private-valuations-requests` | `private-valuations-subscriber` | `company_fundamentals/_private_check_<id>` |
| Ticker catalog | `ticker-catalog-requests` | `ticker-catalog-subscriber` | `directory_syncs/_ticker_<id>` and snapshot pages |
| A-share fundamentals | `cn-fundamentals-requests` | `cn-fundamentals-subscriber` | `company_fundamentals/_cn_request_<id>` |
| US/China EOD | `eod-maintenance-requests` | `eod-maintenance-subscriber` | `eod_runs/_request_<id>`, `_dispatch_<input hash>`, `_queue_<market>` |
| China directory | `cni-directory-requests` | `cni-directory-subscriber` | `directory_syncs/_cni_<id>` and snapshot pages |

These are documents in existing collections. No collection is introduced.

## Shared delivery contract

Each service uses `createJobSubscriber`: a bounded 64 KB envelope, expected
subscription validation, per-job message validation, structured attempt logs, HTTP
204 only after successful processing, and HTTP 503 for retryable failures and invalid
messages. Cloud Run IAM authenticates push requests using the existing scheduler
identity; envelope validation does not replace authentication. Services remain
private, with zero minimum instances, one maximum instance and concurrency one.

Publisher requests are persisted before publication. Scheduled Cloud Run task
retries derive IDs from the execution and replay the original payload. Completed
requests skip processing; transient failures retain checkpoints. Pub/Sub delivery
is at least once. Request retention is seven days; retry delays are configured
for 300–600 seconds and persistent failures are forwarded after approximately
100 attempts to a job-specific dead-letter topic with a seven-day audit subscription.

SEC continues emitting `fundamentals.updated`. The new jobs store results in their
existing documents and logs; no additional result topic or downstream consumer is
introduced. See [SEC details](sec-fundamentals-pubsub.md),
[private valuations](private-valuations-pubsub.md), and
[ticker sync](ticker-sync-pubsub.md) for their specific guarantees.

## A-share fundamentals

The existing weekday job and admin action publish one request per A-share company
in the published map. The subscriber shares `_cn_worker` with direct mode. It checks
annual reports first, checkpoints that stage, then refreshes actions, share counts,
and market caps from stored prices. A completed annual stage is not repeated when
the later stage retries. A crash before its checkpoint may repeat an idempotent
source read; the existing annual freshness guard also applies.

The single-company subscriber treats any failed action/share/write, unresolved
deferred refresh, provider cooldown skip, or unfinished work as retryable. It does
not use the direct full-run allowance for a small number of provider errors.
Validated unavailable share counts are terminal results, not provider failures.
Existing six-hour provider cooldowns and cached financials remain in force.
Processing has a seven-minute budget and reserves time before starting later work.

In Tasks, A-share financials and market caps shows publisher executions;
A-share fundamentals checks shows processing attempts. Publisher success only
means requests were queued. The existing schedule keeps its enabled/paused state,
and initial schedule creation remains paused.

## China directory imports

The existing weekly job and admin action publish an import request. Its subscriber
downloads the CNI snapshot, validates source metadata, uniqueness, IDs,
classifications and minimum record count, and persists it in bounded pages before
writing company data. Failed preparation may download again; prepared imports
always resume from the same snapshot. Only one import remains active across
delivery retries: a newer publisher run republishes that request until it finishes,
preventing different snapshots from interleaving their batches. New direct imports
are blocked while a queued import is active.

Each transaction writes 100 directory records, profiles and research candidates
together with its next-offset checkpoint. It preserves the existing merge rules
for research and editorial data. A failed commit writes none of that batch.
Only after all batches finish does the importer publish final snapshot metadata.
Older snapshots cannot overwrite a newer completed import. Existing direct mode
and subscriber deliveries share `directory_syncs/CN_A_CNI` as their execution lease.
Interrupted leases expire after 30 minutes. Partial imports can be visible while
remaining batches run, as with the previous importer; the entire directory is not
one atomic replacement.

China company directory shows publisher runs; China directory imports shows
processing attempts. Normal worker releases preserve the weekly schedule.

## US/China end-of-day maintenance

The existing authenticated Scheduler endpoint and Admin rerun action return HTTP
202 only after Pub/Sub confirms publication. Dry runs remain synchronous and
read-only. No schedule changes are required. Admin displays queue acceptance and
Tasks shows `eod-maintenance-batch` delivery attempts, filtered by market.

Each request freezes the market, date, options and requesting admin. Scheduler
retries reuse a deterministic request ID; an ambiguous admin publication reuses
the saved original request. An explicit admin rerun after completion creates a
new request. Request records and dispatch pointers use the existing `eod_runs`
collection. Separate dates/options can queue independently; a failed holiday or
unavailable price cannot prevent next day's request from being accepted.

A market lease serializes subscriber processing, while the original engine lease
also excludes simultaneous direct runs. Each page processes at most 50 eligible
predictions, then saves its cursor only after prices, prediction transactions and
user analytics finish. Price/FX failures or missing prediction prices leave the
page retryable. Missing/deleted users retain the engine's existing skip behavior.
Replaying an uncheckpointed page uses existing idempotent mark/score updates.
Completed messages are acknowledged without repeating provider work. This is
at-least-once delivery, not a cross-document exactly-once transaction.

Roll-forward snapshots up to the requested number of available dates (default 5,
maximum 20), completes all prediction pages for each date, and reports the next
date if more remain. `limit` now bounds page size rather than truncating the whole
queued run. Processing reserves a minute before beginning another page; interrupted
leases expire after 30 minutes. Exhausted deliveries use
`eod-maintenance-dead-letter` / `eod-maintenance-dead-letter-audit` with the same
seven-day retention and retry settings as other jobs. A request with unavailable
prices can need operator attention; it never reports successful completion.

The production web rollout first creates the retained request subscription and
publisher permission. A new subscription starts in pull mode until the subsequent
worker rollout configures authenticated push. This prevents requests from being
lost between web and worker releases. The worker receives the existing price
provider settings and object access scoped to the existing EOD bulk cache bucket;
it does not need an AI API key. Rollback must drain or pause EOD push delivery before
restoring the old synchronous web endpoint, then wait for active leases to clear.

## Deployment, verification and recovery

The financial image bundles SEC, private valuation, ticker, A-share and EOD subscribers.
The directory image bundles the CNI publisher and subscriber and includes its
Python downloader. Changed worker detection includes every subscriber, deployment
script and shared dependency. Delivery resources are provisioned before scheduled
jobs switch to publication mode. Routine releases reuse token-creation IAM; only
explicit `PUBSUB_BOOTSTRAP_IAM=1` performs its initial bootstrap.

Deploy through the existing production release workflow or the corresponding
`scripts/deploy-background-jobs.sh` target. Local unit, deployment-stub and browser
tests do not establish that production IAM, provider access or delivery works.
After deployment:

1. Confirm the existing SEC cached-company delivery probe passes.
2. Start the private and A-share publisher jobs through Tasks. Follow their separate
   subscriber entries and correlate batchId, including retries during provider cooldowns.
3. Preview and queue a limited ticker sync; confirm its subscriber completion count.
4. Start the directory publisher and confirm snapshot validation, batch checkpoints
   and final completion under China directory imports.
5. Queue a bounded EOD price-only request for a known cached trading date. Confirm
   its market, request ID, page checkpoint and final completion; verify unauthenticated
   subscriber requests are rejected. Also verify Scheduler/Admin returns queue acceptance.
6. For duplicate verification, republish a completed request unchanged and confirm
   a successful duplicate delivery without provider work or repeated catalog writes.

To recover a failed delivery, fix the cause and replay the original dead-letter
request unchanged. Ledgers and snapshot pages are retained for recovery. Do not
delete topics or clear checkpoints to force retries. Admin history reflects delivery
attempts: a failed attempt can subsequently succeed.

For A-share rollback, pause push delivery and remove `CN_FUNDAMENTALS_REQUEST_TOPIC`
or run with `--direct`. For directory rollback, pause push delivery and remove
`DIRECTORY_REQUEST_TOPIC` or run with `--direct`; an explicit local input file also
uses direct import. Complete an active queued directory import before switching
to direct mode. Wait for other active workers to finish or their leases to expire
before changing execution paths. Existing dry-run behavior remains read-only.
