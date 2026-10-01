# Background Pub/Sub jobs

This rollout extends the existing SEC pattern to private valuation checks, ticker
catalog sync, A-share fundamentals, China directory imports, and US/China EOD
maintenance. Existing recurring maintenance now runs behind Pub/Sub subscribers.

| Work | Request topic | Subscriber service | Durable state |
| --- | --- | --- | --- |
| SEC fundamentals | `sec-fundamentals-requests` | `sec-fundamentals-subscriber` | `company_fundamentals/_batch_<id>` |
| Company graph requests | `company-graph-requests` | `company-graph-subscriber` | Existing `company_research_requests` and `company_research_runs` documents |
| SEC filing discovery | `sec-filings-discovered` (events) | SEC and company graph subscribers | `sec_filings/<accession>` outbox and existing `company_fundamentals` cursors |
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

SEC continues emitting `fundamentals.updated`. The filing collector adds the
`sec.filing.discovered` event on `sec-filings-discovered`, with independent
fundamentals and company graph subscriptions. Other jobs store results in their
existing documents and logs. See [SEC details](sec-fundamentals-pubsub.md),
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

Each request freezes the market, date, options and requesting admin. Queue acceptance
atomically sets the existing EOD cutoff to QUEUED if not already started, so new US
predictions target the next date even while the subscriber is waiting. Scheduler
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

The financial image bundles the SEC collector and the SEC, company graph, private
valuation, ticker, A-share and EOD subscribers, plus their publisher commands.
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


## SEC filing collector and downstream refreshes

The release includes the collector, both independent filing consumers, a bounded
company-graph request publisher, and their release orchestration. The entire new
pipeline remains opt-in; merging or deploying ordinary shared-library changes does
not activate it. Collector deployment verifies both fan-out subscriptions are bound
to `sec-filings-discovered`, rather than accepting names alone.

The `collect-sec-filings-production` job polls SEC submissions using the existing
SEC User-Agent and shared SEC request gate. It has no OpenAI configuration. Each
accession is persisted before its event is published; retries replay the outbox.
The collector uses existing collections, not a separate queue or audit collection.
The first successful submissions snapshot for a company is frozen as a baseline;
historical filings in it do not trigger extraction. Filings first seen after that
snapshot, including later on the same day after an interrupted run, emit events.
Subsequent scans use a seven-day overlap and SEC archive pages to cover downtime.
Per-company checkpoints, a rotating company cursor, a twelve-minute budget, and
the shared SEC rate limit bound collection. The CLI defaults to a read-only plan.
The first complete scan establishes a baseline without publishing historical
filings; later unseen accessions emit events, with overlap and archive checkpoints
to recover gaps. Keep the cursor and outbox during rollout and rollback.
The SEC fundamentals subscriber accepts both its original batch request and filing
events on `SEC_FILINGS_FUNDAMENTALS_SUBSCRIPTION=sec-filings-fundamentals`.
Filing discovery independently drives the company graph subscriber; a graph failure
does not delay fundamentals refreshes.

`ENABLE_SEC_FILING_PIPELINE=1` is an explicit deployment opt-in. With this flag,
`deploy-background-jobs.sh all` and `fundamentals` retain all existing workers and
append graph deployment followed by collector deployment. The `sec-filings` target
deploys SEC fundamentals, company graph, and the collector in that order using one
shared immutable image. `company-graph` deploys only graph delivery and its bounded
publisher. The collector is never deployed before both fan-out consumers exist.

The collector is deployed with `--apply`, but still defaults to
`SEC_FILINGS_COLLECTOR_ENABLED=0`. Its initial 15-minute UTC schedule is paused.
The graph publisher runs every five minutes UTC, publishes one request by default,
and caps `COMPANY_GRAPH_QUEUE_BATCH_SIZE` at 1–5 requests per invocation. Its initial
schedule is also paused. `COMPANY_GRAPH_PROCESSING_ENABLED=0` blocks paid subscriber
work even if a manual or previously queued message arrives while testing delivery.
A valid no-provider verification message can still be processed. Collector and
publisher jobs receive no OpenAI credentials.

Later deployments preserve both new schedules' existing paused/enabled states and
reuse production GitHub Environment variables for the flags and batch size. Keep
`ENABLE_SEC_FILING_PIPELINE`, `SEC_FILINGS_COLLECTOR_ENABLED`, and
`COMPANY_GRAPH_PROCESSING_ENABLED` in that environment after enabling them; an
ad-hoc shell value is not a persistent release setting. The workflow passes the
existing `OPENAI_API_KEY` secret and `OPENAI_MODEL` variable only to the opted-in
graph subscriber via a private temporary environment file. It does not retrieve
credentials from the web service, create/copy keys, or add secret access. The file
is removed after deployment, and credentials are not included in command arguments.
US and China EOD schedulers, request schemas, publication order and prediction
sequencing are unchanged.

New resource-scoped IAM grants require an approved, deliberate bootstrap with
`PUBSUB_BOOTSTRAP_IAM=1`. Ordinary releases check the new resources' exact existing
bindings and fail if one is absent, instead of silently expanding permissions.
The established SEC worker's routine IAM path is unchanged. The new pipeline
reuses its token-creation binding without requiring service-account IAM read
permission from the release identity; the no-provider delivery probe validates auth. Bootstrap includes
publisher grants on the new topics, authenticated subscriber invocation, job
invocation for the existing scheduler/web identities, Pub/Sub dead-letter delivery,
and reuse of the existing push token-creation grant. No new service account,
project-level binding, secret permission, or credential is created. Review these
persistent permission changes before running bootstrap; local tests never run it
against Google Cloud.

The fundamentals filing subscription has its own
`sec-filings-fundamentals-dead-letter` topic and seven-day audit subscription.
Retain these resources and the accession outbox during rollback and replay the
original event unchanged after repairing a failure. Stop new collection by pausing
the collector schedule and setting `SEC_FILINGS_COLLECTOR_ENABLED=0`; already
published messages can still be delivered until each push subscription is paused.


## Company graph delivery and staged activation

Manual graph requests use `company-graph-requests` / `company-graph-worker`;
new filing events use `sec-filings-discovered` / `company-graph-filings`. Both push
to the private `company-graph-subscriber`, with independent dead-letter topics
`company-graph-dead-letter` and `company-graph-filings-dead-letter`. Each has a
seven-day `-audit` subscription. The service accepts only the configured request
and filing subscriptions, runs one delivery at a time, and has a ten-minute Cloud
Run timeout for bounded extraction. Filing-driven graph extraction currently
supports 10-K only; other valid filing forms are acknowledged as ineligible without
calling OpenAI. SEC fundamentals handles its supported forms independently.

Queue records and generations remain in the existing `company_research_requests`;
source selection, provider-response and final-write checkpoints remain in existing
`company_research_runs`, `sec_filings`, and `sec_filing_sections`. Retry the same
request or event so durable checkpoints can be reused. Completed accessions and
obsolete request generations are skipped; older filing delivery does not regress
the latest graph. Pub/Sub is at least once. The graph budget now reserves worst-case cost before
provider submission. A lost response identity retains the reservation and requires
operator review; it cannot automatically start another paid request. An explicit
new extraction generation requires its own reservation. This is not a provider
account-wide billing limit.
Normal **Queue retry** reuses saved provider state. After reviewing a terminal
provider failure, **Start fresh extraction** and its explicit confirmation create
a new generation; the UI warns that this may incur another OpenAI charge.
Truncated stored filing sections are refetched before extraction so retries retain
relationship evidence beyond the stored excerpt limit.

The anonymous request endpoint remains queue-only. Once production is explicitly
opted in, the website receives `COMPANY_GRAPH_REQUEST_TOPIC=company-graph-requests`
and authorized Admin generation queues durable work instead of waiting for paid
extraction. Publication failure is visible and the queue is retained for retry.
When the topic is absent, authorized Admin operations retain the existing direct
behavior. Explicit `direct` and dry-run operator flows remain available.

The production web release prepares the graph request topic, exact publisher
permissions and a retained request subscription before serving the new publisher.
A new subscription starts in pull mode; an existing push configuration is left
unchanged. The later worker release configures authenticated delivery. This
publisher-only preparation needs no OpenAI credential or gcloud beta component.
Staging receives no graph request topic through this rollout.

### Operator rollout checklist

The manual **Set up paused SEC and graph pipeline** workflow applies the approved
new resource bindings using the existing release credentials. It is main-only,
requires the exact main release to have succeeded, keeps processing disabled and
both new schedules paused, and runs cached no-provider delivery probes. It uses
`FILING_PIPELINE_BOOTSTRAP_IAM=1` only for the new resource bindings; the existing
service-account token-creation binding is reused without IAM administration.
It never resumes schedules or enables paid processing. After successful setup,
persist the disabled rollout variables before the next ordinary release.

1. Obtain separate approval for the listed persistent, resource-scoped IAM grants.
   Reusing the existing OpenAI configuration does not authorize new IAM grants.
   Use the manual setup workflow, or have an approved operator run the chosen
   deployment target with `FILING_PIPELINE_BOOTSTRAP_IAM=1`. This scoped flag
   leaves the existing account token-creation binding unchanged. The older
   `PUBSUB_BOOTSTRAP_IAM=1` remains a separate initial account bootstrap option.
   Neither is enabled in routine release CI. No live bootstrap is performed by
   local tests.
2. Persist production `ENABLE_SEC_FILING_PIPELINE=1`, with both
   `SEC_FILINGS_COLLECTOR_ENABLED=0` and `COMPANY_GRAPH_PROCESSING_ENABLED=0`.
   Choose `COMPANY_GRAPH_QUEUE_BATCH_SIZE` from 1–5, starting with 1. Supply the
   existing release OpenAI secret and SEC contact User-Agent through the approved
   release configuration. Deploy `sec-filings` or the full financial target.
3. Confirm the original SEC cached-company delivery probe, then run the graph
   publisher's `--verify-delivery` probe against an existing completed graph cache.
   It must observe successful delivery and a duplicate receipt without SEC or
   OpenAI calls. Keep processing disabled and schedules paused during this step.
   The probe checks manual graph request delivery; it does not establish filing
   fan-out, collector freshness or extraction-provider behavior.
4. Review the collector's default read-only plan and the graph publisher's default
   read-only queue preview. Verify both filing subscriptions' topics, authenticated
   endpoints, private service access and independent dead-letter resources.
   For a bounded collector execution, override `SEC_FILINGS_MAX_COMPANIES=1`
   on that execution. The accepted range is 1–500 (default 500); the rotating
   cursor resumes with the next company on a later run. This bounds discovery
   work, while previously persisted outbox events are still recovered first.
5. Deliberately enable `COMPANY_GRAPH_PROCESSING_ENABLED=1` in the production
   environment and redeploy before a reviewed, limited live extraction. Inspect
   the actual source accession, retained provider/result checkpoints and final
   graph, and confirm a duplicate uses completed state rather than provider work.
6. Enable `SEC_FILINGS_COLLECTOR_ENABLED=1` only after the reviewed baseline and
   limited filing test. Resume each new schedule separately when its workload is
   approved. Resuming the graph publisher can process the existing public queue;
   preview that queue before enabling automatic paid work.

Tasks separates `SEC filing discovery`, `Company graph requests`, and
`Company graph processing`. Publisher success means queue acceptance, not completed
extraction. Worker attempts use `company-graph-batch`; correlate run/request IDs and
filing accessions in Details. Failed attempts can later succeed.

For rollback, pause both new schedules, persist collector and graph-processing
flags as 0, and redeploy the disabled configuration. Stop push delivery separately
when needed; changing a scheduler cannot cancel messages already published. Keep
request and filing subscriptions, outbox/checkpoint documents and audit retention.
Wait for active extraction to finish or its lease to expire before using direct
mode. Removing the web request topic restores the legacy Admin path, so coordinate
that change with processing shutdown. No rollback step needs to alter the existing
US/China EOD schedules or message contracts.

### Strict one-issuer baseline and read-only diagnostics

The normal collector's `SEC_FILINGS_MAX_COMPANIES=1` rotates through the current
US graph and still drains the entire pending outbox. It is **not** a named-issuer,
no-publication canary.

Use the paired `--baseline-only --company=NVDA` options for a strict baseline.
Without `--apply` (or with `--dry-run`) this reads only Firestore: the issuer cursor,
current graph cache eligibility, selected request state, exact global graph-request
status counts and the number of pending filing documents. These are ledger counts,
not Pub/Sub undelivered-message metrics. No SEC/OpenAI request, lease, cursor, or
other data write occurs during inspection.

The main-only **Inspect SEC and graph rollout** workflow runs this read-only mode
with the existing production release identity. It does not provision resources,
create grants, read provider secrets, run Cloud Run jobs, or enable processing.
That identity must already have `datastore.entities.get` for document reads and
`datastore.entities.get` plus `datastore.entities.list` for aggregation queries,
as specified in the [Firestore IAM method permissions](https://docs.cloud.google.com/firestore/native/docs/security/iam).
No transactions or database metadata API calls are requested. If a read is denied,
stop and report the permission error; do not add IAM to make the diagnostic run succeed.
Counts use independent read snapshots and can change if other activity is running.
The workflow also uses the deployment identity's existing `run.services.get` to
verify the web service's `COMPANY_GRAPH_REQUEST_TOPIC`. Only the expected non-secret
topic is printed; other environment values and malformed responses are never
echoed. A missing or different topic fails the check without changing the service.

An explicitly approved baseline application additionally needs `--apply` and an
execution-only `SEC_FILINGS_COLLECTOR_ENABLED=1` override. Keep the persistent flag
at 0 and both schedules paused. This mode:

- Operates on exactly the named issuer, without loading the full graph
- Never queries/drains the pending outbox or publishes any message
- Freezes at most 2,000 eligible recent filing rows / 256 KB and never fetches archives
- Finishes only that frozen snapshot on retry, ignoring later arrivals until a
  separately approved normal collector run
- Preserves existing pending/published records, graph fields and global rotation
- Leaves completed issuer cursors unchanged; replay after completion is read-only
- Refuses a nonbaseline scan or changed issuer identity rather than resetting it

A fresh successful baseline normally makes two budgeted SEC requests: the ticker
mapping and that issuer's submissions JSON. Retrying after the snapshot is saved
needs neither. A failure before the snapshot is saved can repeat those requests;
the existing Cloud Run job permits one retry (up to four source requests in that
case). The mode cannot call OpenAI or cause consumer work. It may merge up to
2,000 existing-collection accession documents, the issuer cursor, collector lease
metadata and shared SEC request-budget metadata. A completed baseline does not
prove live filing fan-out or extraction-provider behavior.

### Executing the separately approved NVIDIA baseline canary

**Run approved NVIDIA baseline only** is a dedicated manual workflow, separate
from the read-only diagnostic. It has no issuer or collector-mode inputs: NVIDIA
and `--baseline-only` are hardcoded. An operator must confirm that specific
execution and supply the exact successful main worker-release commit. The workflow
rejects rerun attempts and checks baseline-support ancestry, successful production
release, immutable deployed image digest and GIT_SHA, single-task/parallelism and
retry bounds, existing runtime identity, disabled collector/graph processing, and
both paused schedules before one job-execution command.

The enable flag applies to that execution only. Persistent configuration is
rechecked afterward. Before execution, existing Firestore read access captures a
bounded NVIDIA ledger snapshot and requires a fresh baseline with no active
collector lease. After execution, Cloud Run must report one successful task with
the exact approved image, NVIDIA baseline arguments and execution-only flag.
The completed cursor must belong to that execution's time window, all prior
NVIDIA discovery records and pending markers must remain unchanged, and every
new discovery must be an unpublished baseline record. The global pending-document
count must remain unchanged. Only a small verification summary is printed;
temporary snapshots are removed when the workflow exits.

An ambiguous execution failure or failed state check must be investigated using
its execution identity; never rerun the execution to recover a missing response.
No new IAM grant, account, credential, collection, schedule, service or Cloud Run
job is created. Existing resource reads, Cloud Run execution reads/override
execution and Firestore get/list/count access must already be permitted. A denial
stops without granting access. Cloud Logging is not used. The proof combines the
isolated baseline code path with successful execution and durable state; it does
not inspect Pub/Sub undelivered-message metrics or count actual SEC requests.

The workflow and its local host-side validation scripts do not change the worker
bundle; they need reviewed CI publication, not another worker redeployment. The
approved worker release may be a later tested descendant containing the strict
baseline implementation, and its actual image must match the supplied release.


## Company graph daily budget and final activation

The Admin Tasks page exposes the graph pipeline's editable daily USD limit,
settled conservative estimate, unresolved reservations and remaining admission
budget. The initial limit is US$5; zero blocks new generation. Reducing the limit
below spent plus reserved liability blocks further requests without reversing
existing charges. A new day follows America/New_York including DST; unresolved
reservations carry across midnight until verified terminal usage is recorded.
This applies to company graph requests, filing-triggered graph work and direct
operator extraction, including paid dry-run requests. Other YouAnalyst AI features,
ChatGPT/Codex allowances, cloud infrastructure charges, taxes and the provider's
account-wide bill are outside this pipeline limit.

Before generation, the exact messages and structured-output schema are sent to
Responses input-token counting. Unknown/malformed counts or more than 100,000 input
tokens block generation. Requests use Standard processing, no tools or external
model context, and max_output_tokens 16,384 (including reasoning and formatting).
Only the verified gpt-5.6-sol price schedule is admitted: reserve all input at the
higher cache-write rate of US$5/million and output at US$20/million. A request's
reservation is at most US$0.82768. Cached-token discounts are deliberately not used
to admit more work. The reviewed price version expires at 2026-11-22T00:00:00Z;
unknown models, expired prices or unavailable budget storage stop new generation.
Sources: https://developers.openai.com/api/docs/models/gpt-5.6-sol and
https://developers.openai.com/api/docs/guides/token-counting.

The aggregate and individual reservations use existing company_research_runs
documents. Transactions reserve before POST across concurrent web/worker calls.
A response ID is saved before normal service checkpointing; retries retrieve that
same response. Missing/ambiguous response IDs retain the full reservation and
require operator review. Only valid terminal usage within the admitted token
bounds releases unused liability; settlement is idempotent. The settled value
is a conservative estimate, not the OpenAI invoice. No new collection or IAM
permission is required.

When the remaining budget cannot admit a request, manual and filing work is saved
for later replay before acknowledging delivery. The existing graph publisher
shares its 1–5 publication limit between manual requests and deferred exact filing
events, respecting next-attempt time and budget availability. Budget exhaustion
does not consume Pub/Sub failure retries. Lowering the budget cannot cancel an
already admitted provider request; its full worst-case amount was reserved.

The existing production release owns the final activation. Set its production
SEC_GRAPH_ACTIVATE_TREE variable to the exact reviewed Git tree, enable both
processing flags, and retain batch size 1. Only that source tree can run the live
activation step after existing delivery checks. It verifies the approved project,
region, exact image digest and model, then uses the existing publisher job for one
saved NVDA forced extraction and one exact baseline 10-K event. The source,
request and activation marker are committed atomically; retries reuse them.
Successful graph/provider/budget completion and both filing-consumer receipts are
required before resuming the existing 5-minute/15-minute schedules. Failure leaves
both paused; a partial resume is rolled back. No new deployment workflow, cloud
resource, collection or IAM grant is involved.

The live result records safe queue-ledger counts and final budget amounts. These
counts are not Pub/Sub backlog metrics. Enabling processing can deliver previously
published work too; all graph requests share the same atomic budget. A later
source tree skips activation, and normal deployments preserve schedule state.
