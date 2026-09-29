# Private valuation checks through Pub/Sub

The existing monthly `refresh-private-valuations-production` Cloud Run Job and
admin Run now action publish one `private-valuation.check.requested` message per
published private company to `private-valuations-requests`. The monthly schedule
remains day 1 at 09:00 America/New_York. Publisher success means checks were queued,
not that source verification finished.

`private-valuations-worker` delivers authenticated push requests to the private
Cloud Run service `private-valuations-subscriber`. It has zero minimum instances,
one maximum instance, concurrency one, and a ten-minute request timeout. Its lease
uses the existing `company_fundamentals/_private_valuation_worker` document, shared
with direct mode to prevent overlap during rollout and rollback.

Messages contain version=1, type=private-valuation.check.requested, batchId,
companyId, and requestedAt. The publisher persists each original message in
`company_fundamentals/_private_check_<batchId>` before publication. The batch ID
derives from the Cloud Run execution and company ID, so a task retry republishes
the same payload. No new Firestore collection is created.

The subscriber rechecks company eligibility, calls the existing reviewed-source
checker, and atomically saves `companies/{id}.privateValuationCheck` and the
completion checkpoint. Completed duplicates skip the source request. A crash
before that transaction commits can repeat a source read. Companies removed
from the published graph or no longer private are checkpointed as skipped.
Reviewed valuation fields, company identity, and market caps are not modified.
There is no result topic in this migration; consumers read the saved check.

HTTP 204 acknowledges a completed check. Provider, database, and validation
failures return 503. Retries are configured for 300–600 seconds, with persistent
failures forwarded after approximately 100 attempts to
`private-valuations-dead-letter`. Its audit subscription and the request
subscription retain messages for seven days. The 30-minute maintenance lease
expires after an interrupted worker. Checkpoint documents are retained for replay.

In `/admin/jobs`, Private company valuations shows publisher executions;
Private valuation checks shows subscriber attempts and results. Review-required,
stale, and unsupported results are completed checks logged as warnings; a source
failure remains retryable. Correlate attempts by batchId and company in logs.

Deployment includes the subscriber in the shared fundamentals image and provisions
its topics, subscriptions, dead-letter permissions, and private service before
switching the publisher job. The runtime receives publisher permission on the
request topic; the web app continues invoking the existing Cloud Run Job.
OIDC uses the existing scheduler identity and its SEC Pub/Sub token-creation
binding. For first-time identity bootstrap, an authorized operator can explicitly
set `PUBSUB_BOOTSTRAP_IAM=1`. Routine releases do not change that binding.

After deployment, use Run now and inspect both publisher and subscriber logs to
verify authenticated delivery. Local tests do not verify production IAM. Replay
a dead-letter request unchanged to the request topic to retry an unfinished check.
An ordinary new run also checks currently eligible companies with new request IDs.

For rollback, pause push delivery by changing the request subscription to pull
mode, then remove `PRIVATE_VALUATIONS_REQUEST_TOPIC` from the publisher job or run
the container with `--direct`. Keep topics and queued messages for recovery.
`--dry-run` and `--sources-only --dry-run` retain their existing read-only behavior.
