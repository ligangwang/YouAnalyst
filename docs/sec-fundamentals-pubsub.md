# SEC fundamentals batch processing

Company page and API reads also publish pending companies after returning the
cached response. A transaction on the existing company document reserves a
five-minute dispatch window, so parallel visitors share one request. Failed
publication retains pending work and permits retry after 30 seconds. A stable
batch ID allows redelivery without repeating completed work. The scheduled
publisher remains a fallback. The web runtime requires publisher permission on
the request topic only; `deploy-sec-pubsub.sh` provisions that binding.

Cached fundamentals remain in server-rendered HTML. Missing/stale pages poll the
cache every five seconds for at most twelve attempts, skipping hidden tabs.
An empty first crawl can still see no financials until background work completes;
this does not guarantee indexing on that first visit.

All SEC transports, including filing downloads, use the shared Firestore gate
`company_fundamentals/_sec_request_budget`. It permits one request at a time,
then waits 200 ms after completion: at most five requests/second across replicas
and jobs, with lower throughput when SEC responses are slow. Each call has a
12-second deadline including queue wait; abandoned gate leases expire after
30 seconds. Firestore failure prevents outgoing requests. HTTP 403 pauses the
gate for at least ten minutes and 429 for at least one minute; a longer
Retry-After extends the cooldown. Existing worker backoff may be longer.
Automatic HTTP redirects are disabled to avoid unbudgeted requests.

Roll out both the website and every SEC-calling worker using the same Firestore
project before claiming the global limit is active. Old revisions bypass the
new gate. Pub/Sub topics, subscriber delivery and publisher IAM must be working
for prompt visit-triggered refreshes; an app-only deployment is insufficient.

The existing daily 21:00 America/New_York job and admin Run now action seed
the existing company queue, publish batches of up to 20 ticker identifiers,
and recalculate cached market caps from stored EOD prices. Publisher success
means messages were queued, not that SEC processing finished.

`sec-fundamentals-requests` delivers to the authenticated Cloud Run service
`sec-fundamentals-subscriber` through `sec-fundamentals-worker`. The subscriber
uses the same company refresh logic, global maintenance lease, sequential SEC
requests and provider cooldown as direct mode. It checkpoints each company in
`company_fundamentals/_batch_<batchId>`; no new Firestore collection is needed.
Reserved metadata documents are excluded from company queries and valuations.

A message contains version=1, type=fundamentals.refresh.requested, batchId,
companyIds (1–20 existing US ticker keys), reason=scheduled_or_manual or filing,
and requestedAt. This first release retains cache freshness rules; a filing
collector and accession-aware refresh scheduling are future work.

Each request has a seven-minute processing budget with 90 seconds reserved before
starting another company. Partial failures return 503; redelivery skips checkpointed
companies. The global 30-minute lease protects against a crashed or timed-out
instance still running. Transient SEC failures retain the existing one-hour
cooldown. Pub/Sub retries every 5–10 minutes and forwards persistent failures
to `sec-fundamentals-dead-letter` after approximately 100 delivery attempts.
Its audit subscription retains messages for seven days.

After saving changes and updating affected market caps, the worker publishes
`fundamentals.updated` to `sec-fundamentals-updates`. A cumulative batch event
contains companyIds, content versions and a deterministic eventId. Freshness-only
changes do not emit an update. Successful companies can emit results even if
other batch members failed. Checkpointed progress also serves as an outbox:
failed publication is retried without refetching SEC data. Delivery is at least
once; consumers must deduplicate eventId and must not assume event ordering.
The updates audit subscription retains results for seven days while additional
consumers are introduced. There is no AI summary consumer in this release.

In /admin/jobs, SEC fundamentals shows publisher executions. SEC fundamentals
batches shows individual delivery attempts with requested, completed, changed,
failed and remaining counts in structured logs. A failed attempt may subsequently
succeed on retry. Correlate attempts using batchId in log details.

Deployment provisions topics, subscriptions, topic-scoped publisher grants and a
private subscriber with zero minimum instances, one maximum instance and one
concurrent request. The shared scheduler identity invokes the subscriber using
OIDC. The Pub/Sub service agent receives token-creation permission on that identity
and dead-letter forwarding permissions. Provisioning must finish before the
existing scheduled job is switched to publication mode.

Rollback: update the existing Cloud Run job to remove FUNDAMENTALS_REQUEST_TOPIC
or run its container with --direct. Pause push delivery by changing the request
subscription to pull mode while investigating. Queued messages remain available
for the configured retention window. Do not delete topics to roll back.

Manual recovery: inspect the dead-letter audit subscription, extract the original
request, and republish it unchanged to the request topic. The ledger resumes
unfinished companies and any pending result publication. An ordinary scheduled
or manual run also republishes eligible pending companies in new batches.
Batch ledgers are retained for recovery in this initial release.

The post-deployment probe uses reason=verification with two existing cached
companies. It verifies authenticated delivery, validation, checkpointing and
completion without fetching SEC data, even when caches have aged past their
refresh time. It never emits an artificial fundamentals.updated event.
