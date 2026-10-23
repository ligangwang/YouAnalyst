# News source queue

The existing hourly `collect-intelligence-news-production` job can publish source
requests instead of fetching every publisher within its eight-minute window.
`NEWS_SOURCE_QUEUE_ENABLED=1` in deployment sets `NEWS_SOURCE_REQUEST_TOPIC` to
`news-source-requests`. With the flag unset, the existing direct path remains
available for a compatible rollout or rollback.

`news-source-subscriber` uses the shared private `createJobSubscriber` server and
`news-source-worker` authenticated Pub/Sub subscription. Each message identifies
one company and source; it never supplies a URL or executable adapter. The worker
loads that company's current approved source configuration before each attempt.
Withdrawn sources or unenrolled companies are acknowledged without fetching.

The publisher only reads existing cursors. It publishes with eight concurrent
requests, skips sources whose next poll or active lease is in the future, and
continues after individual publication failures (the run exits nonzero). No cursor
is advanced by publication; failed publication is eligible on a later schedule.
The execution/source hash gives retries of the same publisher execution stable IDs.

The worker reuses the existing `collectors/<sourceId>` success timestamp, next poll,
ETag/Last-Modified validators, item IDs, backoff and transactional lease. A delivery
already covered by a successful scan is acknowledged. Fetch failures, cooldowns,
active leases and acquisition races return retryable failures. Source approval is
rechecked even on duplicate deliveries. Events retain the existing deduplication,
classification and enrichment queue fields. No new Firestore collection, field,
index or migration is required.

Workers default to four instances with one source per instance. Each source may
fetch up to four article pages concurrently using the existing adapter. This is a
bounded pool, not a global per-domain rate limiter: review shared publisher hosts
and provider limits before increasing `NEWS_SOURCE_MAX_INSTANCES` (1–20).
The existing 120-second source lease is shared with direct collection, preventing
overlap during transition. Fetch transport deadlines remain unchanged.

Analysis, headline translation, disclosures, classification and calendar extraction
remain in the scheduled job with their existing cursors and budgets. Newly collected
articles may be enriched on its next execution. This change scales source fetching;
it does not claim those downstream stages now scale independently.

## Rollout

Build the shared worker image with `serve-intelligence-news.cjs` included. Provision
the new topic, private service, subscription and retained dead-letter audit using
`NEWS_QUEUE_BOOTSTRAP_IAM=1 bash scripts/deploy-news-pubsub.sh` with the existing
maintenance runtime/scheduler identities. This setup does not switch the running
publisher, pause schedules, or alter website traffic. No AI credential is passed
to the fetch worker. Existing Pub/Sub push identity token permissions are reused.

Routine releases keep `NEWS_QUEUE_BOOTSTRAP_IAM=0`: preflight checks the exact
topics, subscription ownership and resource-scoped IAM, failing before replacing
the publisher if setup is incomplete. Deploy the subscriber before enabling
`NEWS_SOURCE_QUEUE_ENABLED=1`. The deployment script wires authenticated push and
dead-letter retention before updating the scheduled job. Verify delivery, cursor
progress, source-level errors and subscription backlog after activation; compare
news freshness with the previous direct runs. The website and all schedules remain
running. Reverting the queue flag restores direct fetching against the same leases;
outstanding queued work remains retained and safe to redeliver.

Failures use the shared Pub/Sub 5–10 minute retry policy, up to 100 delivery
attempts, and seven-day retention. Long publisher cooldowns may move a request to
the audit subscription; the unchanged due cursor also makes it eligible for a
future scheduled publication. Monitor oldest unacknowledged message age, dead
letters, per-source `lastSuccessAt` and `news-health-*` failures. Job success means
dispatch/enrichment succeeded, not that all asynchronous fetches have completed.
