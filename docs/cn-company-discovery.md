# A-share company discovery queue

`CN_DISCOVERY_QUEUE_ENABLED=1` moves announcement discovery and earnings fallback
discovery behind the existing authenticated Pub/Sub subscriber pattern. It defaults
to `0`; shipping this code alone does not activate collection or execute jobs.

The scheduled news job publishes an `announcements` task for each due enrolled
A-share company. The scheduled earnings job publishes `earnings-fallback` tasks
when announcement coverage is missing, incomplete or stale. Both use
`cn-company-discovery-requests`, subscription `cn-company-discovery-worker`, and
the private `cn-company-discovery-subscriber` service. Each message identifies one
company and a discovery mode, never a provider URL. IDs derive from the scheduled
execution, mode and company. Dispatch checks at most eight companies concurrently
and does not advance their discovery cursors.

Each delivery rereads the canonical company record and checks enrollment. Removed
companies are acknowledged without provider requests. Duplicate successful tasks
are acknowledged from their existing completion timestamps. A company lease at
`collectors/exchange-task-<companyId>` serializes both modes, including direct-mode
collectors during a rolling release. Busy, failed and deadline-limited tasks return
HTTP 503 and retry independently. A crashed worker's lease expires after 30 minutes.

Announcement cursors remain `collectors/exchange-<companyId>`; earnings fallback
cursors remain `earnings_collectors/cn_<companyId>`. Their overlap windows,
pagination checks, confirmed disclosure IDs and transactional deduplication are
preserved. Earnings sources go to the existing durable earnings outbox and extraction
queue. A company task publishes only its own committed discoveries before saving
its successful cursor; uncertain publication safely replays the same source identity.
The scheduled earnings job retains bounded global outbox repair for older pending
work. No Firestore collection or persisted field is added.

Workers default to four maximum instances, concurrency one, 1 GiB and a 600-second
request timeout; `CN_DISCOVERY_MAX_INSTANCES` accepts 1–20. Each delivery has a
seven-minute discovery budget. All replicas share the existing transactional CNINFO
gate and cooldown (`earnings_collectors/provider_cninfo`): discovery and earnings
downloads collectively reserve at most one request per second. This does not claim
to throttle the separate legacy fundamentals requester. More workers isolate slow
companies and retries; they do not multiply the shared provider allowance.

## Setup and release

Provision resources with an explicitly selected
`CN_DISCOVERY_BOOTSTRAP_IAM=1` invocation of `scripts/deploy-cn-discovery.sh`,
initially leaving `CN_DISCOVERY_QUEUE_ENABLED=0`. This reuses the existing runtime
and push identities and grants resource-scoped topic, subscription and invoker
bindings. The request and dead-letter audit subscriptions retain messages for
seven days. Push delivery retries after 300–600 seconds, with persistent failures
sent to `cn-company-discovery-dead-letter` after approximately 100 attempts.

Routine releases use `CN_DISCOVERY_BOOTSTRAP_IAM=0`; `--check` validates exact topic
ownership and existing IAM without mutations. Enable the queue explicitly after
setup. News and earnings deployments provision the worker and its subscription
before switching their scheduled publisher. The worker inherits the existing
`EARNINGS_COLLECTION_ENABLED` switch; announcement discovery can run without
earnings, while disabled earnings fallback deliveries remain retained for retry.
No AI key or SEC credential is passed to this discovery service.

To return scheduled discovery to direct mode, set `CN_DISCOVERY_QUEUE_ENABLED=0`
and redeploy the publishers. Do not delete the queue or discard pending deliveries.
Keep collection flags consistent with operator intent. Existing schedules retain
their enabled/paused state during ordinary releases; this pipeline creates no new
schedule and requires no migration or company backfill.

Monitor per-company `run_completed`/`run_failed` logs, partial checkpoints, request
cooldowns, subscription backlog and dead-letter counts. A healthy subscriber alone
does not demonstrate successful discovery for every company.
